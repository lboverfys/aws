/**
 * Content Script - 页面自动化
 * 持续检测页面类型并自动填写表单
 * 包含右上角实时进度 Toast（Shadow DOM 隔离）
 */

(function() {
  'use strict';

  // ============== Toast 通知系统（Shadow DOM 隔离）==============
  let toastHost = null;
  let shadow = null;
  let toastContainer = null;
  let toastContent = null;
  let toastVisible = false;
  let hideTimeout = null;

  /**
   * 创建 Toast 容器（Shadow DOM 隔离，页面 JS 无法检测）
   */
  function createToast() {
    if (toastHost) return;

    toastHost = document.createElement('div');
    // 不设置特征性 inline style，所有样式放入 Shadow DOM 内部
    shadow = toastHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        position: fixed !important;
        top: 0 !important;
        right: 0 !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
      }
      .toast {
        position: fixed;
        top: 16px;
        right: 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        pointer-events: none;
        transition: opacity 0.3s, transform 0.3s;
        opacity: 0;
        transform: translateX(100%);
      }
      .toast.visible {
        opacity: 1;
        transform: translateX(0);
      }
      .toast-inner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        background: linear-gradient(135deg, #232f3e 0%, #1a242f 100%);
        color: #fff;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 153, 0, 0.3);
        min-width: 200px;
        max-width: 350px;
      }
      .toast-icon {
        width: 24px; height: 24px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
      }
      .toast-icon svg { width: 100%; height: 100%; }
      .toast-icon.spinning svg { animation: spin 1.2s linear infinite; }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .toast-text { flex: 1; line-height: 1.4; }
      .toast-title { font-weight: 600; font-size: 12px; color: #ff9900; margin-bottom: 2px; }
      .toast-step { color: rgba(255,255,255,0.9); font-size: 12px; word-break: break-word; }
      .toast-counter { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 4px; }
      .toast.success .toast-inner {
        background: linear-gradient(135deg, #1d4e2c 0%, #143d22 100%);
        box-shadow: 0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(82,196,26,0.3);
      }
      .toast.success .toast-title { color: #52c41a; }
      .toast.error .toast-inner {
        background: linear-gradient(135deg, #4e1d1d 0%, #3d1414 100%);
        box-shadow: 0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(245,34,45,0.3);
      }
      .toast.error .toast-title { color: #f5222d; }
    `;
    shadow.appendChild(style);

    toastContainer = document.createElement('div');
    toastContainer.className = 'toast';
    toastContainer.innerHTML = `
      <div class="toast-inner">
        <div class="toast-icon spinning">
          <svg viewBox="0 0 24 24" fill="none" stroke="#ff9900" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="#ff9900"/>
          </svg>
        </div>
        <div class="toast-text">
          <div class="toast-title">Auto</div>
          <div class="toast-step"></div>
          <div class="toast-counter" style="display:none;"></div>
        </div>
      </div>
    `;
    shadow.appendChild(toastContainer);
    toastHost.style.display = 'contents';
    document.body.insertBefore(toastHost, document.body.firstChild);

    toastContent = {
      title: shadow.querySelector('.toast-title'),
      step: shadow.querySelector('.toast-step'),
      counter: shadow.querySelector('.toast-counter'),
      icon: shadow.querySelector('.toast-icon')
    };
  }

  /**
   * 显示 Toast
   */
  function showToast(state) {
    if (!toastContainer) createToast();
    if (!state) return;

    // 清除隐藏定时器
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    // 更新内容
    const step = state.step || state.status || '处理中...';
    toastContent.step.textContent = step;

    // 更新计数器 - 支持新的状态格式
    if (state.totalTarget > 1) {
      toastContent.counter.style.display = 'block';
      toastContent.counter.textContent = `进度: ${state.totalRegistered}/${state.totalTarget}`;
    } else if (state.loopMode && state.loopCount > 0) {
      // 兼容旧格式
      toastContent.counter.style.display = 'block';
      toastContent.counter.textContent = `已注册: ${state.totalRegistered} / 第 ${state.loopCount} 次`;
    } else {
      toastContent.counter.style.display = 'none';
    }

    // 更新状态样式
    toastContainer.classList.remove('success', 'error');
    toastContent.icon.classList.remove('spinning');

    if (state.status === 'completed') {
      toastContainer.classList.add('success');
      toastContent.title.textContent = '注册成功';
      toastContent.icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#52c41a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12l3 3 5-6"/>
        </svg>
      `;
      // 成功后 5 秒自动隐藏
      hideTimeout = setTimeout(() => hideToast(), 5000);
    } else if (state.status === 'error') {
      toastContainer.classList.add('error');
      toastContent.title.textContent = '注册失败';
      toastContent.step.textContent = state.error || '未知错误';
      toastContent.icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#f5222d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M15 9l-6 6M9 9l6 6"/>
        </svg>
      `;
      // 错误后 8 秒自动隐藏
      hideTimeout = setTimeout(() => hideToast(), 8000);
    } else if (state.status === 'idle') {
      // idle 状态不显示 toast
      hideToast();
      return;
    } else {
      // 进行中状态 (running, polling_token, initializing 等)
      const isMultiWindow = state.totalTarget > 1 || (state.sessions && state.sessions.length > 1);
      toastContent.title.textContent = isMultiWindow ? '批量注册中' : '自动注册';
      toastContent.icon.classList.add('spinning');
      toastContent.icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#ff9900" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
      `;
    }

    // 显示
    toastContainer.classList.add('visible');
    toastVisible = true;
  }

  /**
   * 隐藏 Toast
   */
  function hideToast() {
    if (toastContainer) {
      toastContainer.classList.remove('visible');
      toastVisible = false;
    }
  }

  /**
   * 监听状态更新
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STATE_UPDATE') {
      // 状态更新
      showToast(message.state);
    }
  });

  // 初始化时获取当前状态并显示 Toast
  async function initToast() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (response?.state && response.state.status !== 'idle') {
        showToast(response.state);
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // ============== 页面自动化逻辑 ==============

  // 页面类型
  const PAGE_TYPES = {
    LOGIN: 'login',
    NAME: 'name',
    VERIFY: 'verify',
    PASSWORD: 'password',
    DEVICE_CONFIRM: 'device_confirm',
    ALLOW_ACCESS: 'allow_access',
    COMPLETE: 'complete',
    UNKNOWN: 'unknown'
  };

  // 状态
  let isProcessing = false;
  let accountInfo = null;
  let verificationCode = null;
  let processedPages = new Set(); // 已处理的页面标识
  let pollInterval = null;

  /**
   * 延迟函数
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 查找元素（支持多个选择器）
   */
  function $(selectors) {
    const list = selectors.split(',').map(s => s.trim());
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /**
   * 等待元素出现
   */
  async function waitFor(selectors, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = $(selectors);
      if (el) return el;
      await randomDelay(80, 150);
    }
    throw new Error(`等待元素超时: ${selectors}`);
  }

  /**
   * 更新步骤到 Service Worker 和本地 Toast
   */
  function updateStep(step) {
    chrome.runtime.sendMessage({ type: 'UPDATE_STEP', step }).catch(() => {});
    // 同时更新本地 Toast
    showToast({ step, status: 'initializing' });
  }

  /**
   * 报告错误
   */
  function reportError(error) {
    chrome.runtime.sendMessage({ type: 'REPORT_ERROR', error }).catch(() => {});
  }

  /**
   * 获取账号信息（带重试和详细日志）
   */
  async function getAccountInfo() {
    if (accountInfo && accountInfo.email) {
      return accountInfo;
    }

    for (let i = 0; i < 10; i++) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_INFO' });
        if (response && response.email) {
          accountInfo = response;
          return accountInfo;
        }
      } catch (_) {}
      await sleep(300);
    }

    return null;
  }

  /**
   * 获取验证码（Gmail 别名模式 - 等待用户手动输入）
   */
  async function getVerificationCode() {
    if (verificationCode) {
      return verificationCode;
    }

    updateStep('请手动填写验证码（从 Gmail 收件箱获取）');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_VERIFICATION_CODE' });
      if (response && response.success) {
        verificationCode = response.code;
        return verificationCode;
      }

      // Gmail 别名模式，需要用户手动输入
      if (response && response.needManualInput) {
        return null; // 返回 null 表示需要手动输入
      }
    } catch (_) {}
    return null;
  }

  /**
   * 随机延迟（模拟人类操作的不确定性）
   */
  function randomDelay(min, max) {
    return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
  }

  /**
   * 根据字符返回正确的 KeyboardEvent.code
   */
  function charToCode(char) {
    if (char >= 'a' && char <= 'z') return 'Key' + char.toUpperCase();
    if (char >= 'A' && char <= 'Z') return 'Key' + char;
    if (char >= '0' && char <= '9') return 'Digit' + char;
    const map = {
      ' ': 'Space', '.': 'Period', ',': 'Comma', '/': 'Slash',
      '\\': 'Backslash', '-': 'Minus', '=': 'Equal', ';': 'Semicolon',
      "'": 'Quote', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight',
      '@': 'Digit2', '!': 'Digit1', '#': 'Digit3', '$': 'Digit4',
      '%': 'Digit5', '^': 'Digit6', '&': 'Digit7', '*': 'Digit8',
      '(': 'Digit9', ')': 'Digit0', '_': 'Minus', '+': 'Equal',
      '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash',
      ':': 'Semicolon', '"': 'Quote', '<': 'Comma', '>': 'Period',
      '?': 'Slash', '~': 'Backquote',
    };
    return map[char] || 'Unidentified';
  }

  /**
   * 模拟真实用户输入（逐字符输入，触发正确的事件序列）
   */
  async function humanFill(el, text) {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // 清空现有值
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(el, '');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContent', data: null }));

    // 逐字符输入
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = charToCode(char);

      // keydown
      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code, bubbles: true, cancelable: true }));

      // 设置值
      nativeSetter.call(el, text.slice(0, i + 1));

      // input 事件（使用 InputEvent）
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));

      // keyup
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code, bubbles: true, cancelable: true }));

      // 每个字符之间随机间隔（模拟真实打字速度，偶尔有停顿）
      if (i < text.length - 1) {
        const pause = Math.random() < 0.08 ? 200 + Math.random() * 400 : 30 + Math.random() * 90;
        await randomDelay(pause * 0.8, pause * 1.2);
      }
    }

    // 输入完成后触发 change
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  /**
   * 模拟真实点击（鼠标移动序列 + 随机延迟 + 可信点击）
   */
  async function humanClick(btn) {
    if (!btn) return false;

    if (btn.offsetParent === null || btn.disabled) {
      return false;
    }

    const rect = btn.getBoundingClientRect();
    // 在按钮区域内随机一个点击位置
    const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
    const eventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };

    // 鼠标移动序列（带随机延迟模拟真实鼠标轨迹）
    btn.dispatchEvent(new MouseEvent('mouseover', eventInit));
    btn.dispatchEvent(new MouseEvent('mouseenter', { ...eventInit, bubbles: false }));
    await randomDelay(12, 35);
    btn.dispatchEvent(new MouseEvent('mousemove', eventInit));
    await randomDelay(20, 55);
    btn.dispatchEvent(new MouseEvent('mousedown', eventInit));
    btn.focus();
    await randomDelay(40, 120);
    btn.dispatchEvent(new MouseEvent('mouseup', eventInit));
    await randomDelay(5, 15);

    // 使用 btn.click() 触发可信点击（isTrusted: true）
    btn.click();

    return true;
  }

  /**
   * 检测当前页面类型
   */
  function detectPageType() {
    const url = window.location.href;
    const host = window.location.hostname;
    const text = document.body?.innerText || '';

    // 完成页面
    if (text.includes('successfully authorized') || text.includes('Authorization complete') || text.includes('You have been successfully authorized')) {
      return PAGE_TYPES.COMPLETE;
    }

    // 授权页 - Allow access 按钮（优先检测，因为可能在 awsapps.com 域名下）
    const allowBtn = $('button#cli_login_button, button[data-testid="allow-access-button"], input[type="submit"][value*="Allow"]');
    if (allowBtn && allowBtn.offsetParent !== null) {
      return PAGE_TYPES.ALLOW_ACCESS;
    }
    // 也检查页面文本
    if ((text.includes('Allow access') || text.includes('allow access')) && host.includes('awsapps.com')) {
      return PAGE_TYPES.ALLOW_ACCESS;
    }

    // 设备确认页 - 检查按钮
    const confirmBtn = $('button#cli_verification_btn, button[data-testid="confirm-device-button"]');
    if (confirmBtn && confirmBtn.offsetParent !== null) {
      return PAGE_TYPES.DEVICE_CONFIRM;
    }
    // 也检查页面文本
    if (text.includes('Confirm and continue') || text.includes('confirm this code')) {
      return PAGE_TYPES.DEVICE_CONFIRM;
    }

    // 验证码页
    if (url.includes('verify-otp') || url.includes('verification') || url.includes('verifyEmail')) {
      return PAGE_TYPES.VERIFY;
    }

    // 姓名页
    if (url.includes('enter-email') || url.includes('signup/enter') || url.includes('createAccount')) {
      return PAGE_TYPES.NAME;
    }

    // 密码页 — 只要有一个密码输入框即可识别，不再要求同时找到确认框
    // 通过 URL 或页面上存在多个 password 输入框来判断
    if (url.includes('password') || url.includes('setPassword') || url.includes('create-password')) {
      return PAGE_TYPES.PASSWORD;
    }
    const allPwdInputs = document.querySelectorAll('input[type="password"]');
    if (allPwdInputs.length >= 2) {
      return PAGE_TYPES.PASSWORD;
    }
    // 单个密码框 + 有 "Re-enter" 或 "Confirm" 相关提示也算密码页
    const pwdInput = $('input[placeholder="Enter password"], input[name="password"], input[type="password"][autocomplete="new-password"]');
    const confirmPwdInput = $('input[placeholder="Re-enter password"], input[name="confirmPassword"]');
    if (pwdInput && confirmPwdInput) {
      return PAGE_TYPES.PASSWORD;
    }

    // 登录页 - 支持多种选择器
    const emailInput = $('input[placeholder="username@example.com"], input[name="email"], input[type="email"], input[autocomplete="username"]');
    if (emailInput) {
      return PAGE_TYPES.LOGIN;
    }

    // 姓名页 - DOM 回退（URL 未匹配时，通过输入框特征检测）
    // 此时已排除登录页（无 email 输入框），如果存在 name 输入框则为姓名页
    const nameInputFallback = $('input[placeholder="Maria José Silva"], input[placeholder*="name" i], input[name="name"], input[name="fullName"]');
    if (nameInputFallback) {
      return PAGE_TYPES.NAME;
    }

    return PAGE_TYPES.UNKNOWN;
  }

  /**
   * 生成页面标识（用于避免重复处理）
   */
  function getPageId() {
    const type = detectPageType();
    // 包含 hash，因为 AWS 用 SPA 路由
    const url = window.location.href.split('?')[0] + window.location.hash;
    return `${type}:${url}`;
  }

  /**
   * 处理 Cookie 弹窗
   */
  async function handleCookiePopup() {
    const btn = $('button[data-id="awsccc-cb-btn-accept"]');
    if (btn) {
      await humanClick(btn);
    }
  }

  /**
   * 处理登录页
   */
  async function handleLoginPage() {
    updateStep('填写邮箱...');

    const info = await getAccountInfo();
    if (!info?.email) {
      reportError('无法获取邮箱信息');
      return false;
    }

    const emailInput = $('input[placeholder="username@example.com"], input[name="email"], input[type="email"], input[autocomplete="username"]');
    if (!emailInput) {
      return false;
    }

    await humanFill(emailInput, info.email);
    await randomDelay(300, 700);

    updateStep('点击继续...');
    const btn = $('button[data-testid="test-primary-button"], button[type="submit"], button.awsui-button-variant-primary');
    if (btn) await humanClick(btn);

    return true;
  }

  /**
   * 处理姓名页
   */
  async function handleNamePage() {
    updateStep('填写姓名...');

    const info = await getAccountInfo();
    if (!info?.fullName) {
      reportError('无法获取姓名信息');
      return false;
    }

    // 等待姓名输入框出现（SPA 页面 DOM 可能延迟渲染）
    let nameInput = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      nameInput = $('input[placeholder="Maria José Silva"], input[placeholder*="name" i], input[name="name"], input[name="fullName"]');
      if (nameInput) break;
      await randomDelay(150, 300);
    }

    if (!nameInput) {
      return false;
    }

    await humanFill(nameInput, info.fullName);
    await randomDelay(300, 700);

    updateStep('点击继续...');
    const btn = $('button[data-testid="signup-next-button"], button[type="submit"], button.awsui-button-variant-primary');
    if (btn) await humanClick(btn);

    return true;
  }

  /**
   * 处理验证码页（Gmail 别名模式 - 用户手动输入）
   */
  async function handleVerifyPage() {
    updateStep('请手动填写验证码');

    const code = await getVerificationCode();
    
    // Gmail 别名模式下，code 为 null，需要用户手动输入
    if (!code) {
      // 显示提示，等待用户手动输入
      updateStep('📧 请从 Gmail 收件箱获取验证码并手动填写');
      
      // 不自动填写，让用户手动输入
      // 但仍然标记这个页面已经被处理过（避免重复提示）
      // 返回 true 表示已处理（提示用户），避免重复处理
      // 用户手动填写后会自动点击按钮或按 Enter
      return true;
    }

    // 如果有验证码（从其他来源获取），则自动填写
    updateStep(`填写验证码: ${code}`);
    const codeInput = $('input[placeholder*="位数"], input[placeholder*="digit" i], input[type="text"][maxlength="6"], input[name="code"], input[name="otp"]');
    if (!codeInput) {
      return false;
    }

    await humanFill(codeInput, code);
    await randomDelay(300, 700);

    updateStep('点击验证...');
    const btn = $('button[data-testid="email-verification-verify-button"], button[type="submit"], button.awsui-button-variant-primary');
    if (btn) await humanClick(btn);

    return true;
  }

  /**
   * 处理密码页
   */
  async function handlePasswordPage() {
    updateStep('填写密码...');

    const info = await getAccountInfo();
    if (!info?.password) {
      reportError('无法获取密码信息');
      return false;
    }

    // 等待密码输入框出现（页面跳转后 DOM 可能还没渲染完）
    let pwdInput = null;
    let confirmInput = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      // 找所有 password 输入框
      const allPwd = document.querySelectorAll('input[type="password"]');
      if (allPwd.length >= 2) {
        pwdInput = allPwd[0];
        confirmInput = allPwd[1];
        break;
      }
      // 也尝试具名选择器
      pwdInput = $('input[placeholder="Enter password"], input[name="password"], input[type="password"]:not([name="confirmPassword"])');
      confirmInput = $('input[placeholder="Re-enter password"], input[name="confirmPassword"]');
      if (pwdInput) break;
      await randomDelay(150, 300);
    }

    if (!pwdInput) {
      return false;
    }

    await humanFill(pwdInput, info.password);

    if (confirmInput) {
      await randomDelay(200, 500);
      await humanFill(confirmInput, info.password);
    }

    await randomDelay(300, 700);

    updateStep('点击继续...');
    const btn = $('button[data-testid="test-primary-button"], button[type="submit"], button.awsui-button-variant-primary');
    if (btn) await humanClick(btn);

    return true;
  }

  /**
   * 处理设备确认页
   */
  async function handleDeviceConfirmPage() {
    updateStep('点击确认设备...');
    await randomDelay(400, 900);

    // 尝试多种选择器
    const btn = $('button#cli_verification_btn, button[data-testid="confirm-device-button"], button[type="submit"]');
    if (btn && await humanClick(btn)) {
      updateStep('已确认设备，等待授权页...');
      return true;
    }

    // 如果找不到按钮，尝试查找所有包含 "Confirm" 文字的按钮
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.textContent.includes('Confirm') && await humanClick(b)) {
        updateStep('已确认设备，等待授权页...');
        return true;
      }
    }

    return false;
  }

  /**
   * 处理授权页
   */
  async function handleAllowAccessPage() {
    updateStep('点击允许访问...');
    await randomDelay(400, 900);

    // 尝试多种选择器
    const btn = $('button#cli_login_button, button[data-testid="allow-access-button"], input[type="submit"][value*="Allow"]');
    if (btn && await humanClick(btn)) {
      updateStep('已允许访问，等待完成...');
      chrome.runtime.sendMessage({ type: 'AUTH_COMPLETED' }).catch(() => {});
      return true;
    }

    // 如果找不到按钮，尝试查找所有包含 "Allow" 文字的按钮
    const buttons = document.querySelectorAll('button, input[type="submit"]');
    for (const b of buttons) {
      const text = b.textContent || b.value || '';
      if (text.includes('Allow') && await humanClick(b)) {
        updateStep('已允许访问，等待完成...');
        chrome.runtime.sendMessage({ type: 'AUTH_COMPLETED' }).catch(() => {});
        return true;
      }
    }

    return false;
  }

  /**
   * 处理完成页
   */
  function handleCompletePage() {
    updateStep('授权完成！');
    chrome.runtime.sendMessage({ type: 'AUTH_COMPLETED' }).catch(() => {});
    return true;
  }

  /**
   * 主处理函数
   */
  async function processPage() {
    if (isProcessing) return;

    // 检查是否有正在进行的注册
    const info = await getAccountInfo();
    if (!info?.email) {
      return;
    }

    const pageId = getPageId();
    if (processedPages.has(pageId)) {
      return; // 已处理过
    }

    isProcessing = true;
    await handleCookiePopup();

    const pageType = detectPageType();

    let success = false;
    try {
      switch (pageType) {
        case PAGE_TYPES.LOGIN:
          success = await handleLoginPage();
          break;
        case PAGE_TYPES.NAME:
          success = await handleNamePage();
          break;
        case PAGE_TYPES.VERIFY:
          success = await handleVerifyPage();
          break;
        case PAGE_TYPES.PASSWORD:
          success = await handlePasswordPage();
          break;
        case PAGE_TYPES.DEVICE_CONFIRM:
          success = await handleDeviceConfirmPage();
          break;
        case PAGE_TYPES.ALLOW_ACCESS:
          success = await handleAllowAccessPage();
          break;
        case PAGE_TYPES.COMPLETE:
          success = handleCompletePage();
          break;
        default:
          break;
      }

      if (success) {
        processedPages.add(pageId);
      }
    } catch (error) {
      reportError(error.message);
    } finally {
      isProcessing = false;
    }
  }

  /**
   * 开始持续轮询检测
   */
  function startPolling() {
    if (pollInterval) return;

    // 立即执行一次
    processPage();

    // 使用随机间隔轮询（300-1200ms），避免固定节奏被检测
    function scheduleNext() {
      pollInterval = setTimeout(() => {
        processPage();
        if (pollInterval) scheduleNext();
      }, 300 + Math.random() * 900);
    }
    scheduleNext();
  }

  /**
   * 停止轮询
   */
  function stopPolling() {
    if (pollInterval) {
      clearTimeout(pollInterval);
      pollInterval = null;
    }
  }

  // 页面卸载时停止轮询
  window.addEventListener('beforeunload', stopPolling);

  // 初始化
  async function init() {

    // 等待 DOM 完全加载
    if (document.readyState !== 'complete') {
      await new Promise(resolve => window.addEventListener('load', resolve));
    }

    await randomDelay(150, 350);

    // 初始化 Toast（获取当前状态）
    initToast();

    await randomDelay(150, 350);
    startPolling();
  }

  init();
})();
