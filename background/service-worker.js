/**
 * Service Worker - 后台服务
 * 管理注册状态和流程控制，支持多窗口并发注册
 */

import { MoeMailClient } from '../lib/moemail-api.js';
import { AWSDeviceAuth, validateToken, refreshAndValidateToken, resetSessionUA } from '../lib/oidc-api.js';
import { generatePassword, generateName, generateEmailPrefix } from '../lib/utils.js';
import { generateFingerprintConfig } from '../lib/fingerprint.js';
import { applyFingerprint } from '../content/fingerprint-inject.js';
import { ProxyManager } from '../lib/proxy-manager.js';
import { fetchSubscription } from '../lib/subscription-parser.js';
import { generateXrayConfig, generateSocks5XrayConfig } from '../lib/xray-config-generator.js';

// ============== 调试开关 & 日志包装 ==============
const DEBUG = false;
/* eslint-disable no-console */
function log(...args) { if (DEBUG) console.log(...args); }
function warn(...args) { if (DEBUG) console.warn(...args); }
function err(...args) { if (DEBUG) console.error(...args); }
/* eslint-enable no-console */

// ============== 凭据混淆 ==============
const _OBF_PREFIX = 'obf:';
function obfuscate(plain) {
  if (!plain) return plain;
  try {
    return _OBF_PREFIX + btoa(plain.split('').reverse().join(''));
  } catch { return plain; }
}
function deobfuscate(encoded) {
  if (!encoded || !encoded.startsWith(_OBF_PREFIX)) return encoded;
  try {
    return atob(encoded.slice(_OBF_PREFIX.length)).split('').reverse().join('');
  } catch { return encoded; }
}

// ============== 代理锁 ==============
let proxyLock = Promise.resolve();

// MoeMail 配置
let moemailConfig = { apiUrl: '', apiKey: '', domain: '' };

// 代理配置
let proxyConfigData = { mode: 'none', address: '', apiUrl: '', pool: '' };

// 订阅节点缓存
let subscriptionNodes = [];

// 邮箱渠道
let mailProvider = 'moemail';

// 代理管理器
const proxyManager = new ProxyManager();

// ============== 全局状态 ==============

// 主状态
let globalState = {
  status: 'idle', // idle, running, completed, error
  step: '',
  error: null,
  totalTarget: 0,      // 目标注册数
  totalRegistered: 0,  // 已成功注册数
  totalFailed: 0,      // 失败数
  concurrency: 1,      // 并发数
  lastSuccess: null    // 最后一个成功的记录
};

// 并发会话
let sessions = new Map(); // sessionId -> session
let sessionIdCounter = 0;

// 任务队列
let taskQueue = [];
let isRunning = false;
let shouldStop = false;

// 注册历史记录
let registrationHistory = [];

// 窗口创建锁，防止同时创建多个窗口
let windowCreationLock = Promise.resolve();

// API 调用锁，防止同时调用 AWS/Mail API
let apiCallLock = Promise.resolve();

// ============== 工具函数 ==============

/**
 * 生成唯一会话 ID
 */
function generateSessionId() {
  return `session_${++sessionIdCounter}_${Date.now()}`;
}

/**
 * 等待标签页加载完成
 */
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkTab = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        log(`[waitForTabLoad] tabId=${tabId}, status=${tab.status}, url=${tab.url}`);

        if (tab.status === 'complete') {
          resolve(tab);
          return;
        }
      } catch (e) {
        err(`[waitForTabLoad] tabId=${tabId} 获取失败:`, e);
        reject(new Error('标签页已关闭或不存在'));
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error('等待页面加载超时'));
        return;
      }

      setTimeout(checkTab, 500);
    };

    checkTab();
  });
}

/**
 * 更新状态并通知 popup
 */
function broadcastState() {
  const state = getPublicState();
  // 发送给 extension pages (popup 等)
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    state
  }).catch(() => {
    // popup 可能未打开，忽略错误
  });
  // 发送给所有 tab 中的注入面板
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATE_UPDATE', state }).catch(() => {});
    }
  }).catch(() => {});
}

/**
 * 获取可以发送给 popup 的公开状态
 */
function getPublicState() {
  return {
    status: globalState.status,
    step: globalState.step,
    error: globalState.error,
    totalTarget: globalState.totalTarget === Infinity ? 0 : globalState.totalTarget,
    totalRegistered: globalState.totalRegistered,
    totalFailed: globalState.totalFailed,
    infiniteMode: globalState.infiniteMode || false,
    lastSuccess: globalState.lastSuccess,
    sessions: Array.from(sessions.values()).map(s => ({
      id: s.id,
      status: s.status,
      step: s.step,
      email: s.email,
      error: s.error
    })),
    history: registrationHistory
  };
}

/**
 * 更新全局状态
 */
function updateGlobalState(updates) {
  globalState = { ...globalState, ...updates };
  broadcastState();
}

/**
 * 更新会话状态
 */
function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (session) {
    Object.assign(session, updates);
    broadcastState();
  }
}

// ============== 会话管理 ==============

/**
 * 创建新会话
 */
function createSession() {
  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    status: 'pending', // pending, running, polling_token, completed, error
    step: '等待中...',
    error: null,
    // 账号信息
    email: null,
    password: null,
    firstName: null,
    lastName: null,
    // 邮箱客户端
    mailClient: null,
    mailAccessKey: null,
    manualVerification: false, // MoeMail 自动获取验证码
    // OIDC 客户端
    oidcClient: null,
    oidcAuth: null,
    // 窗口信息
    windowId: null,
    tabId: null,
    // Token 结果
    token: null,
    // 轮询控制
    pollAbort: false,
    // 指纹配置
    fingerprintConfig: null
  };
  sessions.set(sessionId, session);
  return session;
}

/**
 * 销毁会话
 */
async function destroySession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // 关闭窗口
  if (session.windowId) {
    try {
      await chrome.windows.remove(session.windowId);
    } catch (e) {
      // 窗口可能已关闭
    }
  }

  // MoeMail 模式清理临时邮箱
  if (session.mailClient && session.mailClient instanceof MoeMailClient) {
    try {
      await session.mailClient.deleteInbox();
    } catch (e) {
      warn(`[Session ${session.id}] MoeMail 邮箱清理失败:`, e.message);
    }
  }
  session.mailClient = null;

  sessions.delete(sessionId);
}

/**
 * 关闭所有会话
 */
async function closeAllSessions() {
  const promises = Array.from(sessions.keys()).map(id => destroySession(id));
  await Promise.all(promises);
  sessions.clear();
}

// ============== 注册流程 ==============

/**
 * 带锁的 API 调用，防止并发请求导致限流
 */
async function withApiLock(fn) {
  await apiCallLock;
  let releaseLock;
  apiCallLock = new Promise(resolve => { releaseLock = resolve; });
  try {
    return await fn();
  } finally {
    // API 调用后延迟随机时间再释放锁，避免固定节奏
    await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 5000));
    releaseLock();
  }
}

/**
 * 单个会话的注册流程
 */
async function runSessionRegistration(session) {
  try {
    session.status = 'running';
    session.pollAbort = false;
    updateSession(session.id, { step: '初始化...' });

    // 重置 OIDC UA，每个会话使用不同的版本号
    resetSessionUA();

    // 步骤 1: 生成账号信息（先生成，用于邮箱前缀）
    updateSession(session.id, { step: '生成账号信息...' });
    const { firstName, lastName } = generateName();
    const password = generatePassword(12);
    session.firstName = firstName;
    session.lastName = lastName;
    session.password = password;

    // 步骤 2: 设置代理（必须在邮箱创建和 OIDC 调用之前，确保所有请求都走代理）
    let currentProxy = null;
    if (proxyConfigData.mode !== 'none') {
      // 代理锁：确保并发会话串行使用代理
      await proxyLock;
      let releaseProxyLock;
      proxyLock = new Promise(resolve => { releaseProxyLock = resolve; });

      updateSession(session.id, { step: '设置代理...' });
      try {
        if (proxyConfigData.mode === 'manual') {
          currentProxy = proxyManager.parseProxy(proxyConfigData.address);
        } else if (proxyConfigData.mode === 'socks5') {
          // socks5 模式：强制使用 socks5 协议
          const parsed = proxyManager.parseProxy(proxyConfigData.address, 'socks5');
          if (parsed && parsed.username && parsed.password) {
            // SOCKS5 带认证：Chrome 无法原生处理 SOCKS5 认证，通过 xray 本地转发
            const xrayConfig = generateSocks5XrayConfig(parsed, 0);
            updateSession(session.id, { step: `启动 SOCKS5 代理: ${parsed.host}:${parsed.port}...` });
            const localPort = await proxyManager.startSubscriptionProxy(session.id, xrayConfig);
            currentProxy = { scheme: 'socks5', host: '127.0.0.1', port: localPort, username: '', password: '' };
            log(`[Session ${session.id}] SOCKS5 代理已启动 (xray): ${parsed.host}:${parsed.port} -> 127.0.0.1:${localPort}`);
          } else {
            // SOCKS5 无认证：直接使用 PAC 脚本
            currentProxy = parsed;
          }
        } else if (proxyConfigData.mode === 'api') {
          // 从 API 提取代理列表（如果池为空）
          if (proxyManager.proxyPool.length === 0 && proxyConfigData.apiUrl) {
            const proxies = await proxyManager.fetchFromApi(proxyConfigData.apiUrl);
            proxyManager.setPool(proxies);
          }
          currentProxy = proxyManager.getNextProxy();
        } else if (proxyConfigData.mode === 'pool') {
          // 从代理池获取
          if (proxyManager.proxyPool.length === 0 && proxyConfigData.pool) {
            const lines = proxyConfigData.pool.split(/[\r\n]+/).filter(l => l.trim());
            const proxies = lines.map(l => proxyManager.parseProxy(l)).filter(Boolean);
            proxyManager.setPool(proxies);
          }
          currentProxy = proxyManager.getNextProxy();
        } else if (proxyConfigData.mode === 'subscription') {
          // 订阅模式：随机选节点 → 启动 xray → 拿到本地端口
          if (subscriptionNodes.length === 0) {
            throw new Error('订阅节点列表为空，请先提取订阅');
          }
          const nodeIndex = Math.floor(Math.random() * subscriptionNodes.length);
          const node = subscriptionNodes[nodeIndex];
          const xrayConfig = generateXrayConfig(node, 0); // 端口由 native host 分配
          updateSession(session.id, { step: `启动代理: ${node.name || node.host}...` });
          const localPort = await proxyManager.startSubscriptionProxy(session.id, xrayConfig);
          currentProxy = { scheme: 'socks5', host: '127.0.0.1', port: localPort, username: '', password: '' };
          log(`[Session ${session.id}] 订阅代理已启动: ${node.name || node.host} -> 127.0.0.1:${localPort}`);
        }

        if (currentProxy) {
          await proxyManager.applyProxy(currentProxy);
          // 等待代理生效
          await new Promise(resolve => setTimeout(resolve, 300));
          log(`[Session ${session.id}] 代理已设置: ${currentProxy.host}:${currentProxy.port}`);
        }
      } catch (e) {
        warn(`[Session ${session.id}] 代理设置失败:`, e.message);
        // 代理失败不中断注册流程
      } finally {
        releaseProxyLock();
      }
    }

    // 步骤 3: 生成邮箱（代理已生效，邮箱 API 请求也走代理）
    updateSession(session.id, { step: '生成邮箱...' });

    // MoeMail 模式：创建临时邮箱
    if (!moemailConfig.apiUrl || !moemailConfig.apiKey) {
      throw new Error('未配置 MoeMail，请在插件设置中配置 API 地址和 Key');
    }
    session.mailClient = new MoeMailClient({
      apiUrl: moemailConfig.apiUrl,
      apiKey: moemailConfig.apiKey,
      domain: moemailConfig.domain,
    });
    const email = await session.mailClient.createInbox();
    session.email = email;
    session.manualVerification = false; // MoeMail 自动获取验证码
    updateSession(session.id, { email });

    log(`[Session ${session.id}] 账号信息:`, { email: session.email, firstName, lastName });

    // 步骤 4: 获取 OIDC 授权 URL（代理已生效，所有 API 请求走代理 IP）
    updateSession(session.id, { step: '获取授权链接...' });
    session.oidcClient = new AWSDeviceAuth();
    const authInfo = await withApiLock(() => session.oidcClient.quickAuth());
    session.oidcAuth = authInfo;

    log(`[Session ${session.id}] OIDC 授权信息:`, authInfo.verificationUriComplete);

    // 步骤 5: 生成指纹配置（结合代理 IP 地理位置）
    let geoInfo = null;
    if (currentProxy) {
      updateSession(session.id, { step: '查询 IP 地理位置...' });
      geoInfo = await proxyManager.getGeoLocation(currentProxy.host);
    }
    session.fingerprintConfig = generateFingerprintConfig(undefined, geoInfo);
    log(`[Session ${session.id}] 指纹配置:`, session.fingerprintConfig.navigator.platform, session.fingerprintConfig.screen.width + 'x' + session.fingerprintConfig.screen.height, '时区:', session.fingerprintConfig.timezone.name);

    // 步骤 6: 清除无痕模式 Cookie（防止会话间 Cookie 关联）
    updateSession(session.id, { step: '清理会话痕迹...' });
    try {
      const awsDomains = [
        '.amazonaws.com', '.aws.amazon.com', '.signin.aws',
        '.awsapps.com', 'oidc.us-east-1.amazonaws.com'
      ];
      for (const domain of awsDomains) {
        const cookies = await chrome.cookies.getAll({ domain, storeId: '1' }).catch(() => []);
        for (const cookie of cookies) {
          await chrome.cookies.remove({
            url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
            name: cookie.name,
            storeId: cookie.storeId
          }).catch(() => {});
        }
      }
    } catch (_) {
      // Cookie 清理失败不中断流程
    }

    // 步骤 7: 打开无痕窗口（使用锁防止同时创建多个窗口）
    updateSession(session.id, { step: '打开无痕窗口...' });

    // 等待获取窗口创建锁
    await windowCreationLock;
    let releaseLock;
    windowCreationLock = new Promise(resolve => { releaseLock = resolve; });

    try {
      log(`[Session ${session.id}] 准备创建无痕窗口，URL:`, authInfo.verificationUriComplete);

      // 先创建空白窗口，避免首次请求泄露真实 HTTP 头
      const fpScreen = session.fingerprintConfig.screen;
      // 窗口尺寸加入随机偏移，避免固定计算公式被关联
      const widthOffset = 150 + Math.floor(Math.random() * 200); // 150-350
      const heightOffset = 80 + Math.floor(Math.random() * 150);  // 80-230
      const winWidth = Math.min(fpScreen.width - widthOffset, 1366);
      const winHeight = Math.min(fpScreen.height - heightOffset, 900);
      const window = await chrome.windows.create({
        url: 'about:blank',
        incognito: true,
        focused: true,
        width: winWidth,
        height: winHeight
      });

      // 检查窗口和标签页
      if (!window) {
        throw new Error('chrome.windows.create 返回 null/undefined，可能缺少权限或无痕模式未启用');
      }

      if (!window.id) {
        throw new Error(`窗口对象缺少 id 属性，返回值: ${JSON.stringify(window)}`);
      }

      if (!window.tabs || window.tabs.length === 0) {
        throw new Error(`窗口缺少标签页，windowId=${window.id}`);
      }

      session.windowId = window.id;
      session.tabId = window.tabs[0].id;

      // 先注册指纹和 HTTP 头规则，确保首次真实请求就被伪装
      registerTabFingerprint(session.tabId, session.fingerprintConfig);
      // 等待 declarativeNetRequest 规则生效（需要足够时间，否则首个请求泄露真实头）
      await new Promise(resolve => setTimeout(resolve, 500));

      // 规则就绪后再导航到目标 URL
      await chrome.tabs.update(session.tabId, { url: authInfo.verificationUriComplete });
      log(`[Session ${session.id}] 无痕窗口创建成功: windowId=${window.id}, tabId=${session.tabId}`);

      // 等待页面加载完成
      updateSession(session.id, { step: '等待页面加载...' });
      try {
        await waitForTabLoad(session.tabId, 30000);
        log(`[Session ${session.id}] 页面已加载`);
      } catch (e) {
        warn(`[Session ${session.id}] 等待页面加载:`, e.message);
        // 即使超时也继续，content script 会处理
      }

      // 额外等待随机时间让 content script 初始化
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1500));

    } catch (error) {
      err(`[Session ${session.id}] 创建无痕窗口错误:`, error);

      // 根据错误类型给出详细提示
      let errorMsg = '创建无痕窗口失败';

      if (error.message && error.message.includes('cannot be created')) {
        errorMsg = '无法创建无痕窗口，请在扩展设置中启用"在无痕模式下允许"';
      } else if (error.message && (error.message.includes('null/undefined') || error.message.includes('缺少权限'))) {
        errorMsg = '创建窗口失败：请检查扩展权限，重新加载扩展后重试';
      } else if (error.message) {
        errorMsg = error.message;
      }

      throw new Error(errorMsg);
    } finally {
      // 释放窗口创建锁
      releaseLock();
    }

    // 步骤 7: 轮询 Token
    session.status = 'polling_token';
    updateSession(session.id, { step: '自动填表中...' });

    const tokenResult = await pollSessionToken(session);

    if (tokenResult) {
      // 成功
      session.status = 'completed';
      session.token = tokenResult;
      updateSession(session.id, { step: '注册成功!' });

      // 保存到历史
      saveToHistory(session, true);

      // 更新全局状态
      globalState.totalRegistered++;
      globalState.lastSuccess = {
        email: session.email,
        password: session.password,
        firstName: session.firstName,
        lastName: session.lastName,
        token: {
          ...tokenResult,
          clientId: session.oidcAuth?.clientId || '',
          clientSecret: obfuscate(session.oidcAuth?.clientSecret || '')
        }
      };

      return true;
    } else {
      throw new Error('Token 获取超时或被中断');
    }

  } catch (error) {
    err(`[Session ${session.id}] 注册失败:`, error);
    session.status = 'error';
    session.error = error.message;
    updateSession(session.id, { step: '失败: ' + error.message });

    saveToHistory(session, false);
    globalState.totalFailed++;

    return false;
  } finally {
    // 关闭窗口
    if (session.windowId) {
      try {
        await chrome.windows.remove(session.windowId);
        session.windowId = null;
      } catch (e) {
        // 忽略
      }
    }

    // 清除代理
    if (proxyConfigData.mode !== 'none') {
      await proxyManager.clearProxy();
    }

    // 停止订阅代理 / SOCKS5 xray 实例
    if (proxyConfigData.mode === 'subscription' || proxyConfigData.mode === 'socks5') {
      await proxyManager.stopSubscriptionProxy(session.id);
    }

    // MoeMail 模式清理临时邮箱
    if (session.mailClient && session.mailClient instanceof MoeMailClient) {
      try {
        await session.mailClient.deleteInbox();
      } catch (e) {
        // 忽略
      }
    }
    session.mailClient = null;
  }
}

/**
 * 轮询获取 Token
 */
async function pollSessionToken(session) {
  if (!session.oidcClient) return null;

  const startTime = Date.now();
  const timeout = 600000; // 10 分钟超时
  const pollInterval = Math.max(session.oidcClient.interval * 1000, 2000);

  while (!session.pollAbort && !shouldStop && Date.now() - startTime < timeout) {
    try {
      const result = await session.oidcClient.getToken();
      if (result) {
        log(`[Session ${session.id}] Token 获取成功`);
        return result;
      }
    } catch (error) {
      if (!error.message.includes('authorization_pending')) {
        err(`[Session ${session.id}] Token 轮询错误:`, error);
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return null;
}

/**
 * 保存注册结果到历史
 */
function saveToHistory(session, success) {
  let tokenInfo = null;
  if (success && session.token) {
    tokenInfo = {
      ...session.token,
      clientId: session.oidcAuth?.clientId || '',
      clientSecret: obfuscate(session.oidcAuth?.clientSecret || '')
    };
  }

  const record = {
    id: Date.now() + Math.random(),
    time: new Date().toLocaleString(),
    email: session.email,
    password: session.password,
    firstName: session.firstName,
    lastName: session.lastName,
    success: success,
    error: success ? null : session.error,
    token: tokenInfo,
    tokenStatus: success ? 'unknown' : null // unknown, valid, invalid, suspended
  };

  registrationHistory.unshift(record);

  // 只保留最近 100 条记录
  if (registrationHistory.length > 100) {
    registrationHistory = registrationHistory.slice(0, 100);
  }

  // 保存到 storage
  chrome.storage.local.set({ registrationHistory });
}

/**
 * 批量验证所有 Token（并发执行，带进度）
 */
async function validateAllTokens() {
  const results = {
    total: 0,
    valid: 0,
    expired: 0,
    suspended: 0,
    invalid: 0,
    error: 0,
    details: []
  };

  const recordsToValidate = registrationHistory.filter(r => r.success && r.token?.refreshToken);
  results.total = recordsToValidate.length;

  if (results.total === 0) {
    return results;
  }

  // 并发验证（每批 2 个，降低限流风险）
  const concurrency = 2;
  let validated = 0;

  // 通知开始验证
  chrome.runtime.sendMessage({
    type: 'VALIDATION_PROGRESS',
    progress: { validated: 0, total: results.total }
  }).catch(() => {});

  for (let i = 0; i < recordsToValidate.length; i += concurrency) {
    const batch = recordsToValidate.slice(i, i + concurrency);

    // 并发执行当前批次
    const batchResults = await Promise.allSettled(
      batch.map(async (record) => {
        try {
          // 使用刷新并验证的方法（deobfuscate clientSecret）
          const result = await refreshAndValidateToken({
            clientId: record.token.clientId,
            clientSecret: deobfuscate(record.token.clientSecret),
            refreshToken: record.token.refreshToken
          });

          // 更新记录的 token 状态
          record.tokenStatus = result.status;

          // 如果刷新成功，更新 token
          if (result.newAccessToken) {
            record.token.accessToken = result.newAccessToken;
            record.token.refreshToken = result.newRefreshToken;
          }

          return { record, result };
        } catch (error) {
          record.tokenStatus = 'error';
          return { record, result: { status: 'error', error: error.message } };
        }
      })
    );

    // 统计结果
    for (const promiseResult of batchResults) {
      if (promiseResult.status === 'fulfilled') {
        const { result } = promiseResult.value;
        
        switch (result.status) {
          case 'valid':
            results.valid++;
            break;
          case 'suspended':
            results.suspended++;
            results.details.push({ 
              email: promiseResult.value.record.email, 
              status: 'suspended', 
              error: result.error 
            });
            break;
          case 'expired':
            results.expired++;
            results.details.push({ 
              email: promiseResult.value.record.email, 
              status: 'expired', 
              error: result.error 
            });
            break;
          case 'invalid':
            results.invalid++;
            results.details.push({ 
              email: promiseResult.value.record.email, 
              status: 'invalid', 
              error: result.error 
            });
            break;
          case 'error':
            results.error++;
            results.details.push({ 
              email: promiseResult.value.record.email, 
              status: 'error', 
              error: result.error 
            });
            break;
        }
      } else {
        results.error++;
      }

      validated++;
    }

    // 通知进度更新
    chrome.runtime.sendMessage({
      type: 'VALIDATION_PROGRESS',
      progress: { validated, total: results.total }
    }).catch(() => {});

    // 批次间延迟，避免限流
    if (i + concurrency < recordsToValidate.length) {
      await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 3000));
    }
  }

  // 保存更新后的状态
  chrome.storage.local.set({ registrationHistory });
  broadcastState();

  return results;
}

// ============== 批量注册控制 ==============

/**
 * 开始批量注册
 */
async function startBatchRegistration(loopCount, concurrency, options = {}) {
  if (isRunning) {
    return { success: false, error: '已有注册任务在运行' };
  }

  // 设置邮箱渠道
  mailProvider = 'moemail';

  // 使用代理时强制并发为 1，因为 chrome.proxy.settings 是全局的，
  // 并发会导致多个会话互相覆盖代理设置，造成 IP/指纹不匹配
  const proxyMode = options.proxyMode || 'none';
  if (proxyMode !== 'none' && concurrency > 1) {
    warn('[Service Worker] 使用代理时强制并发为 1，避免代理冲突');
    concurrency = 1;
  }

  if (!options.moemailApiUrl || !options.moemailApiKey) {
    return { success: false, error: '未配置 MoeMail API 地址或 Key' };
  }
  moemailConfig = {
    apiUrl: options.moemailApiUrl,
    apiKey: options.moemailApiKey,
    domain: options.moemailDomain || '',
  };

  // 设置代理配置
  proxyConfigData = {
    mode: options.proxyMode || 'none',
    address: options.proxyAddress || '',
    apiUrl: options.proxyApiUrl || '',
    pool: options.proxyPool || '',
    subscriptionUrl: options.proxySubscriptionUrl || '',
  };

  // 如果使用 API 代理模式，预先提取代理列表
  if (proxyConfigData.mode === 'api' && proxyConfigData.apiUrl) {
    try {
      const proxies = await proxyManager.fetchFromApi(proxyConfigData.apiUrl);
      proxyManager.setPool(proxies);
    } catch (e) {
      warn('[Service Worker] 代理 API 提取失败:', e.message);
    }
  } else if (proxyConfigData.mode === 'pool' && proxyConfigData.pool) {
    const lines = proxyConfigData.pool.split(/[\r\n]+/).filter(l => l.trim());
    const proxies = lines.map(l => proxyManager.parseProxy(l)).filter(Boolean);
    proxyManager.setPool(proxies);
  } else if (proxyConfigData.mode === 'subscription' && proxyConfigData.subscriptionUrl) {
    // 订阅模式：获取并解析节点
    try {
      subscriptionNodes = await fetchSubscription(proxyConfigData.subscriptionUrl);
      log(`[Service Worker] 订阅解析成功: ${subscriptionNodes.length} 个节点`);
      if (subscriptionNodes.length === 0) {
        return { success: false, error: '订阅链接未返回有效节点' };
      }
    } catch (e) {
      warn('[Service Worker] 订阅解析失败:', e.message);
      return { success: false, error: '订阅解析失败: ' + e.message };
    }
  }

  isRunning = true;
  shouldStop = false;

  // loopCount = 0 表示无限循环，直到手动停止
  const infiniteMode = loopCount === 0;

  // 重置状态
  globalState = {
    status: 'running',
    step: '开始注册...',
    error: null,
    totalTarget: infiniteMode ? Infinity : loopCount,
    totalRegistered: 0,
    totalFailed: 0,
    concurrency: concurrency,
    lastSuccess: null,
    infiniteMode: infiniteMode,
  };

  sessions.clear();
  broadcastState();

  log(`[Service Worker] 开始批量注册: 目标=${infiniteMode ? '无限' : loopCount}, 并发=${concurrency}, 邮箱渠道=${mailProvider}, 代理=${proxyConfigData.mode}`);

  // 创建任务队列（无限模式不预填队列，由 worker 自行循环）
  taskQueue = [];
  if (!infiniteMode) {
    for (let i = 0; i < loopCount; i++) {
      taskQueue.push(i);
    }
  }

  // 并发执行
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(runWorker(i, infiniteMode));
  }

  await Promise.all(workers);

  // 清理订阅代理 / SOCKS5 xray 实例
  if (proxyConfigData.mode === 'subscription' || proxyConfigData.mode === 'socks5') {
    await proxyManager.stopAllSubscriptionProxies();
    proxyManager.disconnectNativeHost();
  }

  // 完成
  isRunning = false;
  globalState.status = shouldStop ? 'idle' : 'completed';
  globalState.step = shouldStop
    ? `已停止，成功 ${globalState.totalRegistered} 个`
    : `完成！成功 ${globalState.totalRegistered}/${infiniteMode ? '∞' : loopCount} 个`;

  broadcastState();

  return { success: true, state: getPublicState() };
}

/**
 * 工作线程 - 从队列取任务执行
 */
async function runWorker(workerId, infiniteMode = false) {
  log(`[Worker ${workerId}] 启动, 无限模式=${infiniteMode}`);

  // 错开启动时间，避免同时创建窗口和调用 API
  // 第一个 worker 立即启动，后续 worker 等待更长时间
  if (workerId > 0) {
    await new Promise(resolve => setTimeout(resolve, workerId * (2000 + Math.random() * 3000)));
  }

  let taskCounter = 0;

  while (!shouldStop) {
    // 有限模式：从队列取任务，队列空则退出
    if (!infiniteMode) {
      const taskIndex = taskQueue.shift();
      if (taskIndex === undefined) break;
      taskCounter = taskIndex;
    }

    taskCounter++;
    log(`[Worker ${workerId}] 执行任务 #${taskCounter}`);

    // 清理已完成的旧会话，只保留活跃的
    for (const [id, s] of sessions) {
      if (s.status === 'completed' || s.status === 'error') {
        sessions.delete(id);
      }
    }

    // 创建会话
    const session = createSession();

    const done = globalState.totalRegistered + globalState.totalFailed;
    const targetLabel = infiniteMode ? '∞' : globalState.totalTarget;
    updateGlobalState({
      step: `进度 ${done}/${targetLabel}，正在注册第 ${taskCounter} 个...`
    });

    // 执行注册
    await runSessionRegistration(session);

    // 更新全局进度
    const doneAfter = globalState.totalRegistered + globalState.totalFailed;
    updateGlobalState({
      step: `进度 ${doneAfter}/${targetLabel}`
    });

    // 任务间延迟（随机化，避免固定节奏）
    const hasMore = infiniteMode ? !shouldStop : taskQueue.length > 0;
    if (!shouldStop && hasMore) {
      await new Promise(resolve => setTimeout(resolve, 2500 + Math.random() * 2500));
    }
  }

  log(`[Worker ${workerId}] 结束`);
}

/**
 * 停止注册
 */
function stopRegistration() {
  log('[Service Worker] 停止注册');
  shouldStop = true;
  taskQueue = [];

  // 中断所有会话的轮询
  for (const session of sessions.values()) {
    session.pollAbort = true;
  }

  updateGlobalState({ step: '正在停止...' });
}

/**
 * 完全重置状态
 */
async function resetState() {
  shouldStop = true;
  taskQueue = [];
  isRunning = false;

  await closeAllSessions();

  globalState = {
    status: 'idle',
    step: '',
    error: null,
    totalTarget: 0,
    totalRegistered: 0,
    totalFailed: 0,
    concurrency: 1,
    lastSuccess: null
  };

  broadcastState();
}

// ============== 消息处理 ==============

/**
 * 根据 windowId 查找对应的会话（主要方式）
 * windowId 在整个认证流程中保持不变，比 tabId 更可靠
 */
function findSessionByWindowId(windowId) {
  for (const session of sessions.values()) {
    if (session.windowId === windowId) {
      return session;
    }
  }
  return null;
}

/**
 * 获取验证码（MoeMail 自动获取）
 */
async function getVerificationCode(session) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }

  if (!session.mailClient || !(session.mailClient instanceof MoeMailClient)) {
    return { success: false, error: 'MoeMail 客户端未初始化' };
  }

  log(`[Session ${session.id}] MoeMail 模式，自动获取验证码...`);
  updateSession(session.id, { step: '等待验证码...' });

  try {
    const code = await session.mailClient.waitForVerificationCode(120000);
    if (code) {
      log(`[Session ${session.id}] MoeMail 验证码: ${code}`);
      return { success: true, code };
    } else {
      return { success: false, error: 'MoeMail 验证码获取超时' };
    }
  } catch (e) {
    return { success: false, error: 'MoeMail 验证码获取失败: ' + e.message };
  }
}

/**
 * 处理来自 popup 和 content script 的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 用 windowId 查找会话（跨域导航时 tabId 可能变化，windowId 不变）
  const senderWindowId = sender.tab?.windowId;
  const session = senderWindowId ? findSessionByWindowId(senderWindowId) : null;

  if (sender.tab) {
    log('[Service Worker] 收到消息:', message.type,
      'tabId:', sender.tab.id, 'windowId:', senderWindowId,
      'session:', session?.id || 'none');
  } else {
    log('[Service Worker] 收到消息:', message.type, '(popup)');
  }

  switch (message.type) {
    case 'GET_STATE':
      sendResponse({ state: getPublicState() });
      break;

    case 'START_BATCH_REGISTRATION':
      startBatchRegistration(typeof message.loopCount === 'number' ? message.loopCount : 1, message.concurrency || 1, {
        moemailApiUrl: message.moemailApiUrl,
        moemailApiKey: message.moemailApiKey,
        moemailDomain: message.moemailDomain,
        proxyMode: message.proxyMode,
        proxyAddress: message.proxyAddress,
        proxyApiUrl: message.proxyApiUrl,
        proxyPool: message.proxyPool,
        proxySubscriptionUrl: message.proxySubscriptionUrl,
      }).then(sendResponse);
      return true;

    case 'STOP_REGISTRATION':
      stopRegistration();
      sendResponse({ success: true });
      break;

    case 'GET_VERIFICATION_CODE':
      if (session) {
        getVerificationCode(session).then(sendResponse);
        return true;
      } else {
        warn('[Service Worker] GET_VERIFICATION_CODE: 找不到会话, windowId:', senderWindowId);
        sendResponse({ success: false, error: '找不到对应会话' });
      }
      break;

    case 'GET_ACCOUNT_INFO':
      if (session) {
        log(`[Service Worker] GET_ACCOUNT_INFO: 会话 ${session.id}, email: ${session.email}`);
        sendResponse({
          email: session.email,
          password: session.password,
          firstName: session.firstName,
          lastName: session.lastName,
          fullName: session.firstName && session.lastName
            ? `${session.firstName} ${session.lastName}`
            : null
        });
      } else {
        // 列出现有会话帮助调试
        const existingSessions = Array.from(sessions.values()).map(s =>
          `${s.id}(windowId:${s.windowId})`
        ).join(', ');
        warn('[Service Worker] GET_ACCOUNT_INFO: 找不到会话',
          'senderWindowId:', senderWindowId,
          '现有会话:', existingSessions || '无');
        sendResponse({});
      }
      break;

    case 'RESET':
      resetState().then(() => sendResponse({ success: true }));
      return true;

    case 'UPDATE_STEP':
      if (session) {
        updateSession(session.id, { step: message.step });
      }
      sendResponse({ success: true });
      break;

    case 'REPORT_ERROR':
      if (session) {
        session.status = 'error';
        session.error = message.error;
        updateSession(session.id, { step: '错误: ' + message.error });
      }
      sendResponse({ success: true });
      break;

    case 'AUTH_COMPLETED':
      if (session) {
        updateSession(session.id, { step: '授权完成，等待 Token...' });
      }
      sendResponse({ success: true });
      break;

    case 'CLEAR_HISTORY':
      registrationHistory = [];
      chrome.storage.local.remove('registrationHistory');
      sendResponse({ success: true });
      break;

    case 'EXPORT_HISTORY':
      // 导出时自动解混淆 clientSecret，方便外部直接使用
      sendResponse({
        history: registrationHistory.map(r => {
          if (r.token?.clientSecret) {
            return { ...r, token: { ...r.token, clientSecret: deobfuscate(r.token.clientSecret) } };
          }
          return r;
        })
      });
      break;

    case 'VALIDATE_TOKEN':
      // 验证单个 Token
      if (message.accessToken) {
        validateToken(message.accessToken).then(sendResponse);
        return true;
      } else {
        sendResponse({ valid: false, error: '缺少 accessToken' });
      }
      break;

    case 'VALIDATE_ALL_TOKENS':
      // 批量验证所有 Token
      validateAllTokens().then(sendResponse);
      return true;

    case 'GET_VALID_HISTORY':
      // 获取已验证且有效的历史记录（排除 suspended, expired, invalid, error）
      sendResponse({
        history: registrationHistory.filter(r =>
          r.success &&
          r.token &&
          r.tokenStatus !== 'suspended' &&
          r.tokenStatus !== 'expired' &&
          r.tokenStatus !== 'invalid' &&
          r.tokenStatus !== 'error'
        )
      });
      break;

    case 'FETCH_URL':
      // 代理 fetch 请求（content script 受页面 CSP 限制）
      (async () => {
        try {
          const fetchOptions = { method: message.options?.method || 'GET' };
          if (message.options?.headers) fetchOptions.headers = message.options.headers;
          if (message.options?.body) fetchOptions.body = message.options.body;
          const resp = await fetch(message.url, fetchOptions);
          const body = await resp.text();
          sendResponse({ ok: resp.ok, status: resp.status, body });
        } catch (e) {
          sendResponse({ error: e.message });
        }
      })();
      return true;

    case 'GET_PANEL_CSS':
      // 从扩展资源读取 CSS（service worker 可直接 fetch 自身资源）
      fetch(chrome.runtime.getURL('content/panel.css'))
        .then(r => r.text())
        .then(css => sendResponse({ css }))
        .catch(e => sendResponse({ error: e.message }));
      return true;

    case 'CHECK_XRAY':
      // 检查 xray-core 是否可用
      proxyManager.checkXrayAvailable()
        .then(available => sendResponse({ success: true, available }))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'FETCH_SUBSCRIPTION':
      // 预览订阅节点列表
      (async () => {
        try {
          const nodes = await fetchSubscription(message.url);
          subscriptionNodes = nodes;
          sendResponse({
            success: true,
            count: nodes.length,
            nodes: nodes.map(n => ({
              protocol: n.protocol,
              name: n.name || `${n.host}:${n.port}`,
              host: n.host,
              port: n.port
            }))
          });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    default:
      sendResponse({ error: '未知消息类型' });
  }
});

// 监听标签页更新（处理窗口内导航时 tabId 更新）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.incognito && changeInfo.status === 'loading') {
    const session = findSessionByWindowId(tab.windowId);
    if (session && session.tabId !== tabId) {
      log(`[Service Worker] 会话 ${session.id} 标签页更新: ${session.tabId} -> ${tabId}`);
      unregisterTabFingerprint(session.tabId);
      session.tabId = tabId;
      registerTabFingerprint(tabId, session.fingerprintConfig);
    }
  }
});

// 监听窗口关闭
chrome.windows.onRemoved.addListener((windowId) => {
  const session = findSessionByWindowId(windowId);
  if (session) {
    log(`[Service Worker] 会话 ${session.id} 的窗口已关闭`);
    unregisterTabFingerprint(session.tabId);
    session.windowId = null;
    session.tabId = null;
  }
});

// ============== 指纹注入 ==============

// tabId -> fingerprintConfig 的快速查找表，避免注入时的异步延迟
const tabFingerprintMap = new Map();

// 当会话创建窗口时，注册 tabId -> config 映射
function registerTabFingerprint(tabId, config) {
  if (tabId && config) {
    tabFingerprintMap.set(tabId, config);
    applyUAHeaderRules(tabId, config);
  }
}
function unregisterTabFingerprint(tabId) {
  tabFingerprintMap.delete(tabId);
  removeUAHeaderRules(tabId);
}

// 在页面导航提交时注入指纹覆盖代码（在页面 JS 执行前）
// 使用 tabFingerprintMap 做同步查找，避免 chrome.tabs.get 的异步延迟
// 对主框架和子框架（iframe）都注入，防止 iframe 内泄露真实指纹
chrome.webNavigation.onCommitted.addListener((details) => {
  // 优先从快速查找表获取（零延迟）
  let fpConfig = tabFingerprintMap.get(details.tabId);

  if (!fpConfig) {
    // 回退：通过 windowId 查找（有异步延迟）
    chrome.tabs.get(details.tabId).then(tab => {
      const session = findSessionByWindowId(tab.windowId);
      if (!session?.fingerprintConfig) return;
      // 注册到快速查找表，确保后续导航走同步路径
      registerTabFingerprint(details.tabId, session.fingerprintConfig);
      chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [details.frameId] },
        world: 'MAIN',
        injectImmediately: true,
        func: applyFingerprint,
        args: [session.fingerprintConfig]
      }).catch(() => {});
    }).catch(() => {});
    return;
  }

  // 同步路径：直接注入，无异步延迟
  chrome.scripting.executeScript({
    target: { tabId: details.tabId, frameIds: [details.frameId] },
    world: 'MAIN',
    injectImmediately: true,
    func: applyFingerprint,
    args: [fpConfig]
  }).catch(() => {});
});

// ============== HTTP User-Agent 头伪装 ==============
// JS 层面的 navigator.userAgent 已被伪装，但 HTTP 请求头中的 User-Agent 仍是真实值
// 使用 declarativeNetRequest 动态规则按 tabId 修改 HTTP 头

async function applyUAHeaderRules(tabId, fpConfig) {
  if (!fpConfig?.navigator?.userAgent) return;
  const ua = fpConfig.navigator.userAgent;
  const chromeVer = ua.match(/Chrome\/([\d.]+)/)?.[1] || '';
  const majorVer = chromeVer.split('.')[0] || '';
  const platformVersion = fpConfig.navigator.platformVersion || '10.0.19045';
  const notABrandVer = fpConfig.navigator.notABrandVersion || '99';

  // 构建 Accept-Language 头（与 JS 层 navigator.languages 一致）
  const langs = fpConfig.navigator.languages || ['en-US', 'en'];
  const acceptLang = langs.map((lang, i) => {
    if (i === 0) return lang;
    const q = Math.max(0.1, 1 - i * 0.1).toFixed(1);
    return `${lang};q=${q}`;
  }).join(',');

  const ruleId = 10000 + tabId; // 确保 ruleId 唯一且 > 0
  const rule = {
    id: ruleId,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'User-Agent', operation: 'set', value: ua },
        { header: 'sec-ch-ua', operation: 'set', value: `"Chromium";v="${majorVer}", "Google Chrome";v="${majorVer}", "Not-A.Brand";v="${notABrandVer}"` },
        { header: 'sec-ch-ua-full-version', operation: 'set', value: `"${chromeVer}"` },
        { header: 'sec-ch-ua-full-version-list', operation: 'set', value: `"Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}", "Not-A.Brand";v="${notABrandVer}.0.0.0"` },
        { header: 'sec-ch-ua-platform', operation: 'set', value: '"Windows"' },
        { header: 'sec-ch-ua-platform-version', operation: 'set', value: `"${platformVersion}"` },
        { header: 'sec-ch-ua-mobile', operation: 'set', value: '?0' },
        { header: 'sec-ch-ua-arch', operation: 'set', value: '"x86"' },
        { header: 'sec-ch-ua-bitness', operation: 'set', value: '"64"' },
        { header: 'sec-ch-ua-model', operation: 'set', value: '""' },
        { header: 'sec-ch-ua-wow64', operation: 'set', value: '?0' },
        { header: 'Accept-Language', operation: 'set', value: acceptLang },
      ]
    },
    condition: {
      tabIds: [tabId],
      resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other']
    }
  };

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [rule]
    });
  } catch (e) {
    warn('[Service Worker] 设置 UA header 规则失败:', e.message);
  }
}

async function removeUAHeaderRules(tabId) {
  if (!tabId) return;
  const ruleId = 10000 + tabId;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId]
    });
  } catch (_) {}
}

// Service Worker 激活时恢复状态
chrome.runtime.onInstalled.addListener(() => {
  log('[Service Worker] 扩展已安装/更新');
});

// 恢复历史记录
chrome.storage.local.get(['registrationHistory']).then((stored) => {
  if (stored.registrationHistory) {
    registrationHistory = stored.registrationHistory;
    log('[Service Worker] 恢复历史记录:', registrationHistory.length, '条');
  }
});

// ============== 扩展图标点击 → 注入面板 ==============

chrome.action.onClicked.addListener(async (tab) => {
  log('[Service Worker] 扩展图标被点击, tabId:', tab.id, 'url:', tab.url);

  // 受限页面：在当前 tab 打开一个空白页再注入
  const restricted = !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://');

  try {
    let targetTabId = tab.id;

    if (restricted) {
      // 导航到一个可注入的空白页
      await chrome.tabs.update(tab.id, { url: 'https://www.example.com' });
      // 等待页面加载完成
      await new Promise((resolve) => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // 超时保护
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 10000);
      });
      targetTabId = tab.id;
    }

    // 检测是否已注入
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => !!document.querySelector('[data-ext-panel]')
    });

    if (result.result) {
      chrome.tabs.sendMessage(targetTabId, { type: 'TOGGLE_PANEL' }).catch(() => {});
      log('[Service Worker] 面板已存在，切换显示');
    } else {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        files: ['content/panel.js']
      });
      log('[Service Worker] 面板已注入到 tabId:', targetTabId);
    }
  } catch (e) {
    err('[Service Worker] 面板操作失败:', e.message);
  }
});
