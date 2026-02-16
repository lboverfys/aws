/**
 * Content Script - 注入式面板
 * 在当前页面中创建 Shadow DOM 面板，包含全部 popup.js 逻辑
 */
(function () {
  'use strict';

  // 防重复注入：使用随机 data 属性，避免可预测的 ID 被页面检测
  const PANEL_ATTR = '__p' + Math.random().toString(36).slice(2, 8);
  const existing = document.querySelector(`[data-ext-panel]`);
  if (existing) {
    return;
  }

  // ============== Shadow DOM 创建 ==============

  const host = document.createElement('div');
  host.setAttribute('data-ext-panel', PANEL_ATTR);
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647; top:0; left:0; width:0; height:0;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  // 通过 service worker 获取 CSS 内容，避免 content script fetch 限制
  const style = document.createElement('style');
  style.textContent = '* { visibility: hidden; }'; // 加载前隐藏，防止闪烁
  shadow.appendChild(style);
  chrome.runtime.sendMessage({ type: 'GET_PANEL_CSS' })
    .then(resp => { if (resp?.css) style.textContent = resp.css; })
    .catch(e => console.warn('[Panel] CSS 加载失败:', e));

  // ============== 构建 HTML ==============

  const backdrop = document.createElement('div');
  backdrop.className = 'panel-backdrop';
  backdrop.innerHTML = `
    <div class="panel-container">
      <header class="header">
        <h1>AWS 自动注册</h1>
        <p class="subtitle">Builder ID 一键注册工具</p>
        <button class="panel-close-btn" id="panel-close-btn" title="关闭">&times;</button>
      </header>
      <div class="panel-body">
        <!-- 左栏：配置 -->
        <div class="panel-col panel-col-left">

          <!-- 邮箱配置 -->
          <div id="gmail-section" class="section gmail-section">
            <div class="section-header"><h2>邮箱配置</h2></div>
            <div class="mail-provider-select">
              <select id="mail-provider" class="provider-select">
                <option value="gmail">Gmail 别名</option>
                <option value="moemail">MoeMail</option>
              </select>
            </div>
            <div id="gmail-config" class="gmail-config">
              <div class="gmail-input-row">
                <input type="email" id="gmail-address" placeholder="输入你的 Gmail 地址" class="gmail-input">
                <button id="gmail-save-btn" class="btn-small">保存</button>
              </div>
              <p class="gmail-hint">自动生成别名变体，验证码需手动填写</p>
              <p class="gmail-status" id="gmail-status"></p>
            </div>
            <div id="moemail-config" class="gmail-config" style="display:none">
              <div class="gmail-input-row">
                <input type="url" id="moemail-api-url" placeholder="MoeMail API 地址 (https://...)" class="gmail-input">
              </div>
              <div class="gmail-input-row">
                <input type="text" id="moemail-api-key" placeholder="API Key (mk_xxx)" class="gmail-input">
              </div>
              <div class="gmail-input-row">
                <input type="text" id="moemail-domain" placeholder="邮箱域名 (如 mail.example.com)" class="gmail-input">
                <button id="moemail-save-btn" class="btn-small">保存</button>
              </div>
              <p class="gmail-hint">MoeMail 临时邮箱，验证码自动获取</p>
              <p class="gmail-status" id="moemail-status"></p>
            </div>
          </div>

          <!-- 代理配置 -->
          <div id="proxy-section" class="section proxy-section">
            <div class="section-header"><h2>代理配置</h2></div>
            <div class="proxy-mode-select">
              <select id="proxy-mode" class="provider-select">
                <option value="none">不使用代理</option>
                <option value="manual">手动配置</option>
                <option value="socks5">SOCKS5</option>
                <option value="api">API 提取</option>
                <option value="pool">代理池</option>
              </select>
            </div>
            <div id="proxy-manual-config" class="proxy-config-panel" style="display:none">
              <div class="gmail-input-row">
                <input type="text" id="proxy-address" placeholder="host:port:user:pass" class="gmail-input">
                <button id="proxy-save-btn" class="btn-small">保存</button>
              </div>
            </div>
            <div id="proxy-socks5-config" class="proxy-config-panel" style="display:none">
              <div class="gmail-input-row">
                <input type="text" id="socks5-host" placeholder="IP 地址" class="gmail-input" style="flex:2">
                <input type="number" id="socks5-port" placeholder="端口" class="gmail-input" style="flex:1" min="1" max="65535">
              </div>
              <label class="socks5-auth-row">
                <input type="checkbox" id="socks5-auth-check">
                <span>需要身份验证</span>
              </label>
              <div id="socks5-auth-fields" style="display:none">
                <div class="gmail-input-row">
                  <input type="text" id="socks5-username" placeholder="用户名" class="gmail-input">
                  <input type="password" id="socks5-password" placeholder="密码" class="gmail-input">
                </div>
              </div>
              <button id="socks5-save-btn" class="btn-small" style="margin-top:6px">保存</button>
            </div>
            <div id="proxy-api-config" class="proxy-config-panel" style="display:none">
              <div class="gmail-input-row">
                <input type="url" id="proxy-api-url" placeholder="代理提取 API 地址" class="gmail-input">
                <button id="proxy-fetch-btn" class="btn-small btn-small-primary">提取</button>
              </div>
            </div>
            <div id="proxy-pool-config" class="proxy-config-panel" style="display:none">
              <textarea id="proxy-pool-list" class="proxy-pool-textarea" placeholder="每行一个 host:port:user:pass" rows="3"></textarea>
              <button id="proxy-pool-save-btn" class="btn-small" style="margin-top:6px">保存</button>
            </div>
            <p class="proxy-status" id="proxy-status"></p>
          </div>

          <!-- 设置 + 操作 -->
          <div id="settings-section" class="section settings-section">
            <div class="settings-row">
              <div class="setting-item">
                <label>注册数量</label>
                <input type="number" id="loop-count" min="1" max="100" value="1" class="setting-input">
              </div>
              <div class="setting-item">
                <label>并发窗口</label>
                <input type="number" id="concurrency" min="1" max="3" value="1" class="setting-input">
              </div>
            </div>
            <p class="settings-hint">Gmail 建议并发 1；MoeMail 支持多并发</p>
          </div>

          <div id="action-section" class="section">
            <button id="start-btn" class="btn btn-primary">开始注册</button>
            <button id="stop-btn" class="btn btn-danger" style="display:none">停止</button>
            <button id="reset-btn" class="btn btn-outline" style="display:none">重新开始</button>
          </div>

        </div>

        <!-- 右栏：状态与结果 -->
        <div class="panel-col panel-col-right">

          <!-- 状态显示 -->
          <div id="status-section" class="section card">
            <div class="status-indicator">
              <span id="status-dot" class="dot idle"></span>
              <span id="status-text">准备就绪</span>
              <span id="counter" class="counter" style="display:none"></span>
            </div>
            <div id="step-text" class="step-text"></div>
          </div>

          <!-- 验证状态 -->
          <div id="validate-section" class="section validate-section" style="display:none">
            <div class="validate-info"><span id="validate-text">正在验证...</span></div>
          </div>

          <!-- 错误 -->
          <div id="error-section" class="section error-section" style="display:none">
            <div class="error-icon">!</div>
            <div id="error-text" class="error-text"></div>
          </div>

          <!-- 并发会话 -->
          <div id="sessions-section" class="section card" style="display:none">
            <h2>运行中的会话</h2>
            <div id="sessions-list" class="sessions-list"></div>
          </div>

          <!-- 账号信息 -->
          <div id="account-section" class="section card" style="display:none">
            <h2>当前账号</h2>
            <div class="info-grid">
              <div class="info-item">
                <label>邮箱</label>
                <div class="info-value">
                  <span id="email-value">-</span>
                  <button class="copy-btn" data-target="email-value" title="复制">复制</button>
                </div>
              </div>
              <div class="info-item">
                <label>密码</label>
                <div class="info-value">
                  <span id="password-value">-</span>
                  <button class="copy-btn" data-target="password-value" title="复制">复制</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Token -->
          <div id="token-section" class="section card" style="display:none">
            <h2>Token</h2>
            <div class="info-grid">
              <div class="info-item full-width">
                <label>Access Token</label>
                <div class="info-value token-value">
                  <span id="access-token-value" class="token-text">-</span>
                  <button class="copy-btn" data-target="access-token-value" title="复制">复制</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 历史记录 -->
          <div id="history-section" class="section card">
            <div class="section-header">
              <h2>注册历史</h2>
              <div class="section-actions">
                <button id="validate-btn" class="btn-small btn-small-primary" title="验证所有 Token 状态">验证</button>
                <button id="export-btn" class="btn-small" title="导出有效 Token (JSON)">JSON</button>
                <button id="export-csv-btn" class="btn-small" title="导出完整信息 (CSV)">CSV</button>
                <button id="clear-btn" class="btn-small btn-small-danger">清空</button>
              </div>
            </div>
            <div id="history-list" class="history-list">
              <div class="history-empty">暂无记录</div>
            </div>
          </div>

        </div>
      </div>
      <footer class="footer">
        <p>无痕模式需在扩展设置中启用</p>
      </footer>
    </div>`;
  shadow.appendChild(backdrop);

  // ============== 自定义 alert / confirm ==============

  function showAlert(msg) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'panel-dialog-overlay';
      overlay.innerHTML = `
        <div class="panel-dialog">
          <div class="panel-dialog-message">${escapeHtml(msg)}</div>
          <div class="panel-dialog-actions">
            <button class="btn btn-primary" style="min-width:70px">确定</button>
          </div>
        </div>`;
      const container = shadow.querySelector('.panel-container');
      container.appendChild(overlay);
      overlay.querySelector('.btn').addEventListener('click', () => {
        overlay.remove();
        resolve();
      });
    });
  }

  function showConfirm(msg) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'panel-dialog-overlay';
      overlay.innerHTML = `
        <div class="panel-dialog">
          <div class="panel-dialog-message">${escapeHtml(msg)}</div>
          <div class="panel-dialog-actions">
            <button class="btn btn-outline" style="min-width:70px">取消</button>
            <button class="btn btn-primary" style="min-width:70px">确定</button>
          </div>
        </div>`;
      const container = shadow.querySelector('.panel-container');
      container.appendChild(overlay);
      const btns = overlay.querySelectorAll('.btn');
      btns[0].addEventListener('click', () => { overlay.remove(); resolve(false); });
      btns[1].addEventListener('click', () => { overlay.remove(); resolve(true); });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ============== Helper: fetch via service worker ==============

  async function swFetch(url, options = {}) {
    const resp = await chrome.runtime.sendMessage({
      type: 'FETCH_URL',
      url,
      options: {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body || null
      }
    });
    if (resp && resp.error) throw new Error(resp.error);
    return resp;
  }

  // ============== DOM 引用 (shadow 内) ==============

  const $ = (sel) => shadow.querySelector(sel);
  const $$ = (sel) => shadow.querySelectorAll(sel);

  const statusDot = $('#status-dot');
  const statusText = $('#status-text');
  const stepText = $('#step-text');
  const counter = $('#counter');
  const loopCountInput = $('#loop-count');
  const concurrencyInput = $('#concurrency');
  const startBtn = $('#start-btn');
  const stopBtn = $('#stop-btn');
  const resetBtn = $('#reset-btn');
  const errorSection = $('#error-section');
  const errorText = $('#error-text');
  const sessionsSection = $('#sessions-section');
  const sessionsList = $('#sessions-list');
  const accountSection = $('#account-section');
  const emailValue = $('#email-value');
  const passwordValue = $('#password-value');
  const tokenSection = $('#token-section');
  const accessTokenValue = $('#access-token-value');
  const historyList = $('#history-list');
  const exportBtn = $('#export-btn');
  const exportCsvBtn = $('#export-csv-btn');
  const clearBtn = $('#clear-btn');
  const validateBtn = $('#validate-btn');
  const validateSection = $('#validate-section');
  const validateText = $('#validate-text');
  const gmailAddressInput = $('#gmail-address');
  const gmailSaveBtn = $('#gmail-save-btn');
  const gmailStatus = $('#gmail-status');
  const mailProviderSelect = $('#mail-provider');
  const gmailConfigDiv = $('#gmail-config');
  const moemailConfigDiv = $('#moemail-config');
  const moemailApiUrlInput = $('#moemail-api-url');
  const moemailApiKeyInput = $('#moemail-api-key');
  const moemailDomainInput = $('#moemail-domain');
  const moemailSaveBtn = $('#moemail-save-btn');
  const moemailStatus = $('#moemail-status');
  const proxyModeSelect = $('#proxy-mode');
  const proxyManualConfig = $('#proxy-manual-config');
  const proxyApiConfig = $('#proxy-api-config');
  const proxyPoolConfig = $('#proxy-pool-config');
  const proxyAddressInput = $('#proxy-address');
  const proxySaveBtn = $('#proxy-save-btn');
  const proxyApiUrlInput = $('#proxy-api-url');
  const proxyFetchBtn = $('#proxy-fetch-btn');
  const proxyPoolList = $('#proxy-pool-list');
  const proxyPoolSaveBtn = $('#proxy-pool-save-btn');
  const proxyStatus = $('#proxy-status');
  const proxySocks5Config = $('#proxy-socks5-config');
  const socks5HostInput = $('#socks5-host');
  const socks5PortInput = $('#socks5-port');
  const socks5AuthCheck = $('#socks5-auth-check');
  const socks5AuthFields = $('#socks5-auth-fields');
  const socks5UsernameInput = $('#socks5-username');
  const socks5PasswordInput = $('#socks5-password');
  const socks5SaveBtn = $('#socks5-save-btn');
  // ============== 状态变量 ==============

  let gmailAddress = '';
  let moemailConfig = { apiUrl: '', apiKey: '', domain: '' };
  let proxyConfig = { mode: 'none', address: '', apiUrl: '', pool: '' };

  // ============== UI 更新 ==============

  function updateUI(state) {
    console.log('[Panel] 更新 UI:', state);

    statusDot.className = 'dot';
    switch (state.status) {
      case 'idle': statusDot.classList.add('idle'); statusText.textContent = '准备就绪'; break;
      case 'running': statusDot.classList.add('processing'); statusText.textContent = '注册进行中'; break;
      case 'completed': statusDot.classList.add('success'); statusText.textContent = '全部完成'; break;
      case 'error': statusDot.classList.add('error'); statusText.textContent = '发生错误'; break;
      default: statusDot.classList.add('idle'); statusText.textContent = state.status || '未知状态';
    }

    if (state.totalTarget > 0) {
      counter.style.display = 'inline';
      counter.textContent = `${state.totalRegistered}/${state.totalTarget}`;
    } else {
      counter.style.display = 'none';
    }

    stepText.textContent = state.step || '';

    if (state.error) {
      errorSection.style.display = 'flex';
      errorText.textContent = state.error;
    } else {
      errorSection.style.display = 'none';
    }

    const isRunning = state.status === 'running';
    const isIdle = state.status === 'idle';
    const isFinished = state.status === 'completed' || state.status === 'error';

    loopCountInput.disabled = !isIdle;
    concurrencyInput.disabled = !isIdle;

    if (isIdle) {
      startBtn.style.display = 'flex'; stopBtn.style.display = 'none'; resetBtn.style.display = 'none';
    } else if (isRunning) {
      startBtn.style.display = 'none'; stopBtn.style.display = 'flex'; resetBtn.style.display = 'none';
    } else if (isFinished) {
      startBtn.style.display = 'none'; stopBtn.style.display = 'none';
      resetBtn.style.display = 'flex'; resetBtn.style.flex = '1';
    }

    if (state.sessions && state.sessions.length > 0) {
      sessionsSection.style.display = 'block';
      renderSessions(state.sessions);
    } else {
      sessionsSection.style.display = 'none';
    }

    if (state.lastSuccess) {
      accountSection.style.display = 'block';
      emailValue.textContent = state.lastSuccess.email || '-';
      passwordValue.textContent = state.lastSuccess.password || '-';
    } else {
      accountSection.style.display = 'none';
    }

    if (state.lastSuccess?.token) {
      tokenSection.style.display = 'block';
      accessTokenValue.textContent = state.lastSuccess.token.accessToken || '-';
    } else {
      tokenSection.style.display = 'none';
    }

    renderHistory(state.history || []);
  }

  function renderSessions(sessions) {
    sessionsList.innerHTML = sessions.map((session, index) => {
      let statusClass = 'running';
      if (session.status === 'completed') statusClass = 'success';
      else if (session.status === 'error') statusClass = 'error';
      return `
        <div class="session-item">
          <span class="session-id">#${index + 1}</span>
          <span class="session-status ${statusClass}"></span>
          <span class="session-step">${escapeHtml(session.step || session.status)}</span>
          <span class="session-email">${escapeHtml(session.email || '')}</span>
        </div>`;
    }).join('');
  }

  function renderHistory(history) {
    if (!history || history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无记录</div>';
      return;
    }
    historyList.innerHTML = history.slice(0, 50).map(item => {
      let statusClass = item.success ? 'success' : 'failed';
      if (item.success && item.tokenStatus) {
        const m = { valid:'success', suspended:'suspended', expired:'expired', invalid:'invalid', error:'error', unknown:'unknown' };
        statusClass = m[item.tokenStatus] || 'unknown';
      }
      let tokenBadge = '';
      if (item.success && item.tokenStatus) {
        const labels = { valid:'有效', suspended:'封禁', expired:'过期', invalid:'无效', error:'错误', unknown:'未验证' };
        tokenBadge = `<span class="token-badge ${item.tokenStatus}">${labels[item.tokenStatus] || item.tokenStatus}</span>`;
      }
      return `
        <div class="history-item" data-id="${item.id}">
          <div class="history-status ${statusClass}"></div>
          <div class="history-info">
            <div class="history-email">${escapeHtml(item.email || '-')}${tokenBadge}</div>
            <div class="history-time">${escapeHtml(item.time || '')}</div>
          </div>
          <div class="history-actions">
            ${item.success && item.token ? `<button class="kiro-btn" data-id="${item.id}" title="同步至 Claude Code IDE">Kiro</button>` : ''}
            <button class="copy-btn-record" data-id="${item.id}">复制</button>
          </div>
        </div>`;
    }).join('');
  }

  // ============== 事件委托：历史记录按钮 ==============

  historyList.addEventListener('click', async (e) => {
    const target = e.target;
    if (target.classList.contains('kiro-btn')) {
      await syncToKiro(target.getAttribute('data-id'));
    }
    if (target.classList.contains('copy-btn-record')) {
      await copyRecord(target.getAttribute('data-id'));
    }
  });

  // ============== 业务函数 ==============

  function detectOS() {
    const p = navigator.platform.toLowerCase();
    const u = navigator.userAgent.toLowerCase();
    if (p.includes('win') || u.includes('windows')) return 'windows';
    if (p.includes('mac') || u.includes('macintosh')) return 'macos';
    return 'linux';
  }

  async function syncToKiro(id) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EXPORT_HISTORY' });
      const record = response.history?.find(r => String(r.id) === String(id));
      if (!record) { await showAlert('找不到该记录'); return; }
      if (!record.token) { await showAlert('该记录没有 Token 信息'); return; }

      const { clientId, clientSecret, accessToken, refreshToken } = record.token;
      if (!clientId || !accessToken) { await showAlert('Token 信息不完整'); return; }

      const encoder = new TextEncoder();
      const data = encoder.encode(clientId);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const clientIdHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      const clientExpiresAt = new Date(Date.now() + 90 * 86400 * 1000).toISOString();

      const authToken = JSON.stringify({
        accessToken, refreshToken, expiresAt, clientIdHash,
        authMethod: 'IdC', provider: 'BuilderId', region: 'us-east-1'
      }, null, 2);

      const clientInfo = JSON.stringify({
        clientId, clientSecret, expiresAt: clientExpiresAt
      }, null, 2);

      const os = detectOS();
      let command = '', terminalName = '';

      if (os === 'windows') {
        const ae = authToken.replace(/`/g, '``').replace(/\$/g, '`$');
        const ce = clientInfo.replace(/`/g, '``').replace(/\$/g, '`$');
        command = `$ssoDir = "$env:USERPROFILE\\.aws\\sso\\cache"\nif (!(Test-Path $ssoDir)) { New-Item -ItemType Directory -Force -Path $ssoDir | Out-Null }\n$utf8NoBom = New-Object System.Text.UTF8Encoding $false\n$authToken = @"\n${ae}\n"@\n$clientInfo = @"\n${ce}\n"@\n[System.IO.File]::WriteAllText("$ssoDir\\kiro-auth-token.json", $authToken, $utf8NoBom)\n[System.IO.File]::WriteAllText("$ssoDir\\${clientIdHash}.json", $clientInfo, $utf8NoBom)\nWrite-Host "已同步至 Kiro IDE (UTF-8 无 BOM)" -ForegroundColor Green`;
        terminalName = 'PowerShell';
      } else {
        command = `mkdir -p ~/.aws/sso/cache && cat > ~/.aws/sso/cache/kiro-auth-token.json << 'EOF'\n${authToken}\nEOF\ncat > ~/.aws/sso/cache/${clientIdHash}.json << 'EOF'\n${clientInfo}\nEOF\necho "已同步至 Kiro IDE"`;
        terminalName = '终端';
      }

      await navigator.clipboard.writeText(command);
      await showAlert(`检测到 ${os === 'windows' ? 'Windows' : os === 'macos' ? 'macOS' : 'Linux'} 系统\n命令已复制到剪贴板\n\n请在 ${terminalName} 中粘贴执行`);
    } catch (err) {
      await showAlert('同步失败: ' + err.message);
    }
  }

  async function copyRecord(id) {
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_HISTORY' });
    const record = response.history?.find(r => String(r.id) === String(id));
    if (record) {
      const text = `邮箱: ${record.email}\n密码: ${record.password}\n姓名: ${record.firstName} ${record.lastName}\nToken: ${record.token?.accessToken || '无'}`;
      await navigator.clipboard.writeText(text);
      await showAlert('已复制到剪贴板');
    }
  }

  async function copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.classList.add('copied');
      const orig = button.textContent;
      button.textContent = '已复制';
      setTimeout(() => { button.classList.remove('copied'); button.textContent = orig; }, 1500);
    } catch (err) {
      console.error('复制失败:', err);
    }
  }

  // ============== 注册控制 ==============

  async function startRegistration() {
    const loopCount = parseInt(loopCountInput.value) || 1;
    const concurrency = parseInt(concurrencyInput.value) || 1;
    const mailProv = mailProviderSelect.value;

    if (mailProv === 'gmail') {
      if (!gmailAddress) { await showAlert('请先配置 Gmail 地址'); gmailAddressInput.focus(); return; }
    } else if (mailProv === 'moemail') {
      if (!moemailConfig.apiUrl || !moemailConfig.apiKey) { await showAlert('请先配置 MoeMail API 地址和 API Key'); moemailApiUrlInput.focus(); return; }
    }

    if (loopCount < 1 || loopCount > 100) { await showAlert('注册数量需在 1-100 之间'); return; }
    if (concurrency < 1 || concurrency > 3) { await showAlert('并发窗口需在 1-3 之间'); return; }

    if (mailProv === 'gmail' && concurrency > 1) {
      const ok = await showConfirm('使用 Gmail 别名模式时，建议并发设为 1（需要手动输入验证码）。\n\n是否继续？');
      if (!ok) return;
    }

    startBtn.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_BATCH_REGISTRATION',
        loopCount, concurrency, gmailAddress,
        mailProvider: mailProv,
        moemailApiUrl: moemailConfig.apiUrl,
        moemailApiKey: moemailConfig.apiKey,
        moemailDomain: moemailConfig.domain,
        proxyMode: proxyConfig.mode,
        proxyAddress: proxyConfig.address,
        proxyApiUrl: proxyConfig.apiUrl,
        proxyPool: proxyConfig.pool,
      });
      if (response.state) updateUI(response.state);
    } catch (error) {
      console.error('[Panel] 注册错误:', error);
      updateUI({ status: 'error', error: error.message });
    } finally {
      startBtn.disabled = false;
    }
  }

  async function stopRegistration() {
    try { await chrome.runtime.sendMessage({ type: 'STOP_REGISTRATION' }); }
    catch (error) { console.error('[Panel] 停止错误:', error); }
  }

  async function reset() {
    try {
      await chrome.runtime.sendMessage({ type: 'RESET' });
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      updateUI(response?.state || { status: 'idle', history: [] });
    } catch (error) { console.error('[Panel] 重置错误:', error); }
  }

  async function exportHistory() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EXPORT_HISTORY' });
      const history = response.history || [];
      if (history.length === 0) { await showAlert('暂无记录'); return; }

      const validRecords = history.filter(r =>
        r.success && r.token &&
        r.tokenStatus !== 'suspended' && r.tokenStatus !== 'expired' &&
        r.tokenStatus !== 'invalid' && r.tokenStatus !== 'error'
      );
      if (validRecords.length === 0) { await showAlert('没有有效的注册记录（可能全部被封禁、过期或无效）'); return; }

      const jsonData = validRecords.map(r => ({
        clientId: r.token?.clientId || '', clientSecret: r.token?.clientSecret || '',
        accessToken: r.token?.accessToken || '', refreshToken: r.token?.refreshToken || ''
      }));
      const jsonStr = JSON.stringify(jsonData, null, 2);
      triggerDownload(jsonStr, `accounts-${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8');

      const totalSuccess = history.filter(r => r.success && r.token).length;
      if (validRecords.length < totalSuccess) {
        await showAlert(`已导出 ${validRecords.length} 个有效账号（共 ${totalSuccess} 个成功注册，${totalSuccess - validRecords.length} 个被过滤）`);
      }
    } catch (error) { console.error('[Panel] 导出错误:', error); }
  }

  async function exportHistoryCSV() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EXPORT_HISTORY' });
      const history = response.history || [];
      if (history.length === 0) { await showAlert('暂无记录'); return; }

      const headers = ['email','password','first_name','last_name','client_id','client_secret','access_token','refresh_token','success','token_status','error'];
      const rows = history.map(r => [
        r.email||'', r.password||'', r.firstName||'', r.lastName||'',
        r.token?.clientId||'', r.token?.clientSecret||'', r.token?.accessToken||'', r.token?.refreshToken||'',
        r.success?'true':'false', r.tokenStatus||'', r.error||''
      ]);
      const csv = [headers,...rows].map(row => row.map(cell => `"${(cell||'').replace(/"/g,'""')}"`).join(',')).join('\n');
      triggerDownload('\uFEFF' + csv, `accounts-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    } catch (error) { console.error('[Panel] 导出 CSV 错误:', error); }
  }

  function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function clearHistory() {
    const ok = await showConfirm('确定要清空所有历史记录吗？');
    if (!ok) return;
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
      renderHistory([]);
    } catch (error) { console.error('[Panel] 清空错误:', error); }
  }

  async function validateAllTokens() {
    validateBtn.disabled = true;
    validateSection.style.display = 'block';
    validateSection.classList.remove('validate-result');
    validateText.textContent = '正在验证所有 Token (0/0)...';

    try {
      const progressListener = (message) => {
        if (message.type === 'VALIDATION_PROGRESS') {
          const { validated, total } = message.progress;
          validateText.textContent = `正在验证 Token (${validated}/${total})...`;
        }
      };
      chrome.runtime.onMessage.addListener(progressListener);

      const response = await chrome.runtime.sendMessage({ type: 'VALIDATE_ALL_TOKENS' });
      chrome.runtime.onMessage.removeListener(progressListener);

      validateSection.classList.add('validate-result');
      const parts = [];
      if (response.valid > 0) parts.push(`${response.valid} 有效`);
      if (response.expired > 0) parts.push(`${response.expired} 过期`);
      if (response.suspended > 0) parts.push(`${response.suspended} 封禁`);
      if (response.invalid > 0) parts.push(`${response.invalid} 无效`);
      if (response.error > 0) parts.push(`${response.error} 错误`);
      validateText.textContent = `验证完成: ${parts.join(', ')}`;

      setTimeout(() => { validateSection.style.display = 'none'; }, 5000);

      const stateResponse = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (stateResponse?.state) updateUI(stateResponse.state);
    } catch (error) {
      console.error('[Panel] 验证错误:', error);
      validateSection.classList.add('validate-result');
      validateText.textContent = '验证失败: ' + error.message;
    } finally {
      validateBtn.disabled = false;
    }
  }

  // ============== 邮箱渠道 ==============

  function switchMailProvider(provider) {
    gmailConfigDiv.style.display = provider === 'gmail' ? 'block' : 'none';
    moemailConfigDiv.style.display = provider === 'moemail' ? 'block' : 'none';
  }

  async function loadMoemailConfig() {
    try {
      const result = await chrome.storage.local.get(['moemailConfig', 'mailProvider']);
      if (result.moemailConfig) {
        moemailConfig = result.moemailConfig;
        moemailApiUrlInput.value = moemailConfig.apiUrl || '';
        moemailApiKeyInput.value = moemailConfig.apiKey || '';
        moemailDomainInput.value = moemailConfig.domain || '';
        if (moemailConfig.apiUrl && moemailConfig.apiKey) updateMoemailStatus(true);
      }
      if (result.mailProvider) {
        mailProviderSelect.value = result.mailProvider;
        switchMailProvider(result.mailProvider);
      }
    } catch (error) { console.error('[MoeMail] 加载配置错误:', error); }
  }

  async function saveMoemailConfig() {
    const apiUrl = moemailApiUrlInput.value.trim();
    const apiKey = moemailApiKeyInput.value.trim();
    const domain = moemailDomainInput.value.trim();
    if (!apiUrl) { moemailStatus.textContent = '请输入 API 地址'; moemailStatus.classList.add('error'); return; }
    if (!apiKey) { moemailStatus.textContent = '请输入 API Key'; moemailStatus.classList.add('error'); return; }
    try {
      moemailConfig = { apiUrl, apiKey, domain };
      await chrome.storage.local.set({ moemailConfig });
      updateMoemailStatus(true);
    } catch (error) { moemailStatus.textContent = '保存失败: ' + error.message; moemailStatus.classList.add('error'); }
  }

  function updateMoemailStatus(saved) {
    if (saved && moemailConfig.apiUrl) {
      moemailStatus.textContent = `✓ 已配置: ${moemailConfig.apiUrl}`;
      moemailStatus.classList.remove('error');
    } else { moemailStatus.textContent = ''; moemailStatus.classList.remove('error'); }
  }

  // ============== 代理配置 ==============

  function switchProxyMode(mode) {
    proxyManualConfig.style.display = mode === 'manual' ? 'block' : 'none';
    proxySocks5Config.style.display = mode === 'socks5' ? 'block' : 'none';
    proxyApiConfig.style.display = mode === 'api' ? 'block' : 'none';
    proxyPoolConfig.style.display = mode === 'pool' ? 'block' : 'none';
  }

  async function loadProxyConfig() {
    try {
      const result = await chrome.storage.local.get(['proxyConfig']);
      if (result.proxyConfig) {
        proxyConfig = result.proxyConfig;
        proxyModeSelect.value = proxyConfig.mode || 'none';
        proxyAddressInput.value = proxyConfig.address || '';
        proxyApiUrlInput.value = proxyConfig.apiUrl || '';
        proxyPoolList.value = proxyConfig.pool || '';
        switchProxyMode(proxyConfig.mode);
        // 回填 socks5 字段
        if (proxyConfig.mode === 'socks5' && proxyConfig.address) {
          try {
            const url = new URL(proxyConfig.address);
            socks5HostInput.value = url.hostname || '';
            socks5PortInput.value = url.port || '';
            if (url.username) {
              socks5AuthCheck.checked = true;
              socks5AuthFields.style.display = 'block';
              socks5UsernameInput.value = decodeURIComponent(url.username);
              socks5PasswordInput.value = decodeURIComponent(url.password || '');
            }
          } catch {}
        }
        if (proxyConfig.mode !== 'none') updateProxyStatus(true);
      }
    } catch (error) { console.error('[Proxy] 加载配置错误:', error); }
  }

  async function saveProxyConfig() {
    const mode = proxyModeSelect.value;
    proxyConfig.mode = mode;
    if (mode === 'manual') proxyConfig.address = proxyAddressInput.value.trim();
    else if (mode === 'socks5') {
      const host = socks5HostInput.value.trim();
      const port = socks5PortInput.value.trim();
      if (!host || !port) { proxyStatus.textContent = '请输入 IP 和端口'; proxyStatus.classList.add('error'); return; }
      const user = socks5AuthCheck.checked ? socks5UsernameInput.value.trim() : '';
      const pass = socks5AuthCheck.checked ? socks5PasswordInput.value.trim() : '';
      const auth = user && pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
      proxyConfig.address = `socks5://${auth}${host}:${port}`;
    }
    else if (mode === 'api') proxyConfig.apiUrl = proxyApiUrlInput.value.trim();
    else if (mode === 'pool') proxyConfig.pool = proxyPoolList.value.trim();
    try {
      await chrome.storage.local.set({ proxyConfig });
      updateProxyStatus(true);
    } catch (error) { proxyStatus.textContent = '保存失败: ' + error.message; proxyStatus.classList.add('error'); }
  }

  async function fetchProxiesFromApi() {
    const apiUrl = proxyApiUrlInput.value.trim();
    if (!apiUrl) { proxyStatus.textContent = '请输入 API 地址'; proxyStatus.classList.add('error'); return; }

    proxyFetchBtn.disabled = true;
    proxyFetchBtn.textContent = '提取中...';
    proxyStatus.textContent = '';

    try {
      const resp = await swFetch(apiUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = resp.body;

      let count = 0;
      try {
        const json = JSON.parse(text);
        const list = Array.isArray(json) ? json : (json.data || json.proxies || json.list || []);
        count = list.length;
      } catch { count = text.split(/[\r\n]+/).filter(l => l.trim()).length; }

      proxyConfig.apiUrl = apiUrl;
      proxyConfig.mode = 'api';
      await chrome.storage.local.set({ proxyConfig });
      proxyStatus.textContent = `✓ 已提取 ${count} 个代理`;
      proxyStatus.classList.remove('error');
    } catch (error) {
      proxyStatus.textContent = '提取失败: ' + error.message;
      proxyStatus.classList.add('error');
    } finally {
      proxyFetchBtn.disabled = false;
      proxyFetchBtn.textContent = '提取';
    }
  }

  function updateProxyStatus(saved) {
    if (!saved || proxyConfig.mode === 'none') { proxyStatus.textContent = ''; return; }
    const labels = { manual: '手动代理', socks5: 'SOCKS5', api: 'API 提取', pool: '代理池' };
    proxyStatus.textContent = `✓ 模式: ${labels[proxyConfig.mode] || proxyConfig.mode}`;
    proxyStatus.classList.remove('error');
  }

  // ============== Gmail 配置 ==============

  async function loadGmailConfig() {
    try {
      const result = await chrome.storage.local.get(['gmailAddress']);
      if (result.gmailAddress) {
        gmailAddress = result.gmailAddress;
        gmailAddressInput.value = gmailAddress;
        updateGmailStatus(true);
      }
    } catch (error) { console.error('[Gmail] 加载配置错误:', error); }
  }

  async function saveGmailConfig() {
    const email = gmailAddressInput.value.trim();
    if (!email) { gmailStatus.textContent = '请输入邮箱地址'; gmailStatus.classList.add('error'); return; }
    if (!email.includes('@')) { gmailStatus.textContent = '邮箱格式无效'; gmailStatus.classList.add('error'); return; }
    try {
      gmailAddress = email;
      await chrome.storage.local.set({ gmailAddress: email });
      updateGmailStatus(true);
    } catch (error) { gmailStatus.textContent = '保存失败: ' + error.message; gmailStatus.classList.add('error'); }
  }

  function updateGmailStatus(saved) {
    if (saved && gmailAddress) {
      gmailStatus.textContent = `✓ 已配置: ${gmailAddress}`;
      gmailStatus.classList.remove('error');
    } else { gmailStatus.textContent = ''; gmailStatus.classList.remove('error'); }
  }

  // ============== 面板显示/隐藏 ==============

  function showPanel() { backdrop.style.display = 'flex'; }
  function hidePanel() { backdrop.style.display = 'none'; }
  function togglePanel() {
    if (backdrop.style.display === 'none') showPanel();
    else hidePanel();
  }

  // 关闭按钮
  $('#panel-close-btn').addEventListener('click', hidePanel);

  // 点击遮罩关闭
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hidePanel();
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.style.display !== 'none') {
      hidePanel();
    }
  });

  // ============== 消息监听 ==============

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_PANEL') {
      togglePanel();
      sendResponse({ success: true });
    } else if (message.type === 'STATE_UPDATE') {
      updateUI(message.state);
    }
  });

  // ============== 初始化 ==============

  async function init() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (response?.state) updateUI(response.state);
    } catch (error) { console.error('[Panel] 获取状态错误:', error); }

    await loadGmailConfig();
    await loadMoemailConfig();
    await loadProxyConfig();

    // 绑定按钮事件
    startBtn.addEventListener('click', startRegistration);
    stopBtn.addEventListener('click', stopRegistration);
    resetBtn.addEventListener('click', reset);
    exportBtn.addEventListener('click', exportHistory);
    exportCsvBtn.addEventListener('click', exportHistoryCSV);
    clearBtn.addEventListener('click', clearHistory);
    validateBtn.addEventListener('click', validateAllTokens);

    gmailSaveBtn.addEventListener('click', saveGmailConfig);
    gmailAddressInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') saveGmailConfig(); });

    mailProviderSelect.addEventListener('change', (e) => {
      switchMailProvider(e.target.value);
      chrome.storage.local.set({ mailProvider: e.target.value });
    });

    moemailSaveBtn.addEventListener('click', saveMoemailConfig);

    proxyModeSelect.addEventListener('change', (e) => {
      switchProxyMode(e.target.value);
      proxyConfig.mode = e.target.value;
      chrome.storage.local.set({ proxyConfig });
      updateProxyStatus(e.target.value !== 'none');
    });
    proxySaveBtn.addEventListener('click', saveProxyConfig);
    proxyFetchBtn.addEventListener('click', fetchProxiesFromApi);
    proxyPoolSaveBtn.addEventListener('click', saveProxyConfig);
    socks5AuthCheck.addEventListener('change', () => {
      socks5AuthFields.style.display = socks5AuthCheck.checked ? 'block' : 'none';
    });
    socks5SaveBtn.addEventListener('click', saveProxyConfig);

    // 复制按钮
    shadow.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const targetElement = shadow.querySelector('#' + targetId);
        if (targetElement && targetElement.textContent !== '-') {
          copyToClipboard(targetElement.textContent, btn);
        }
      });
    });
  }

  // 直接调用 init（不需要 DOMContentLoaded，因为是动态注入的）
  init();

})();
