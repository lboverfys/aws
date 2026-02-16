/**
 * 代理管理器
 * 支持手动配置、API 提取、代理池轮换
 * 通过 chrome.proxy API 设置代理，支持认证
 */

const _DEBUG = false;
const _log = (...a) => { if (_DEBUG) console.log(...a); };
const _warn = (...a) => { if (_DEBUG) console.warn(...a); };

export class ProxyManager {
  constructor() {
    this.proxyPool = [];
    this.poolIndex = 0;
    this.currentProxy = null;
    this.authHandler = null;
    this.geoCache = new Map(); // IP -> geoInfo 缓存
  }

  /**
   * 解析代理字符串
   * 支持格式:
   *   host:port:user:pass
   *   host:port
   *   http://user:pass@host:port
   *   socks5://user:pass@host:port
   */
  parseProxy(proxyStr) {
    proxyStr = proxyStr.trim();
    if (!proxyStr) return null;

    // URL 格式: scheme://user:pass@host:port
    try {
      if (proxyStr.includes('://')) {
        const url = new URL(proxyStr);
        return {
          scheme: url.protocol.replace(':', ''),
          host: url.hostname,
          port: parseInt(url.port) || 80,
          username: decodeURIComponent(url.username || ''),
          password: decodeURIComponent(url.password || ''),
        };
      }
    } catch {}

    // host:port:user:pass 格式
    const parts = proxyStr.split(':');
    if (parts.length >= 2) {
      return {
        scheme: 'http',
        host: parts[0],
        port: parseInt(parts[1]) || 80,
        username: parts[2] || '',
        password: parts[3] || '',
      };
    }

    return null;
  }
  /**
   * 从 API 提取代理列表
   * @param {string} apiUrl 代理提取 API 地址
   * @returns {Array} 代理信息数组
   */
  async fetchFromApi(apiUrl) {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`代理 API 请求失败 (${response.status})`);
    }

    const text = await response.text();
    const proxies = [];

    // 尝试 JSON 解析
    try {
      const json = JSON.parse(text);
      const list = Array.isArray(json) ? json : (json.data || json.proxies || json.list || []);
      for (const item of list) {
        if (typeof item === 'string') {
          const p = this.parseProxy(item);
          if (p) proxies.push(p);
        } else if (item.host || item.ip) {
          proxies.push({
            scheme: item.scheme || item.type || 'http',
            host: item.host || item.ip,
            port: parseInt(item.port) || 80,
            username: item.username || item.user || '',
            password: item.password || item.pass || '',
          });
        }
      }
    } catch {
      // 纯文本格式，每行一个代理
      const lines = text.split(/[\r\n]+/).filter(l => l.trim());
      for (const line of lines) {
        const p = this.parseProxy(line);
        if (p) proxies.push(p);
      }
    }

    _log(`[ProxyManager] 从 API 提取到 ${proxies.length} 个代理`);
    return proxies;
  }

  /**
   * 设置代理池
   */
  setPool(proxies) {
    this.proxyPool = proxies;
    this.poolIndex = 0;
  }

  /**
   * 从代理池中获取下一个代理（轮换）
   */
  getNextProxy() {
    if (this.proxyPool.length === 0) return null;
    const index = Math.floor(Math.random() * this.proxyPool.length);
    return this.proxyPool[index];
  }

  /**
   * 设置 Chrome 代理
   * 使用 PAC script 方式，支持 HTTP/SOCKS 代理
   */
  async applyProxy(proxyInfo) {
    if (!proxyInfo) return;

    this.currentProxy = proxyInfo;
    const { scheme, host, port, username, password } = proxyInfo;

    // socks4 不支持远程 DNS，存在 DNS 泄露风险
    if (scheme === 'socks4') {
      _warn('[ProxyManager] socks4 不支持远程 DNS 解析，存在 DNS 泄露风险，建议使用 socks5');
    }

    // 构建 PAC script
    const proxyType = scheme === 'socks5' ? 'SOCKS5' : (scheme === 'socks4' ? 'SOCKS4' : 'PROXY');
    const pacScript = `function FindProxyForURL(url, host) { return "${proxyType} ${host}:${port}"; }`;

    await chrome.proxy.settings.set({
      value: {
        mode: 'pac_script',
        pacScript: { data: pacScript }
      },
      scope: 'regular'
    });

    // 设置代理认证
    if (username && password) {
      this._setupAuthHandler(username, password);
    }

    _log(`[ProxyManager] 代理已设置: ${scheme}://${host}:${port}`);
  }
  /**
   * 设置代理认证处理器
   * MV3 使用 webRequestAuthProvider 权限
   */
  _setupAuthHandler(username, password) {
    // 移除旧的监听器
    this._removeAuthHandler();

    this.authHandler = (details, callback) => {
      callback({ authCredentials: { username, password } });
    };

    // MV3: 使用 asyncBlocking 替代 blocking
    chrome.webRequest.onAuthRequired.addListener(
      this.authHandler,
      { urls: ['<all_urls>'] },
      ['asyncBlocking']
    );
  }

  /**
   * 移除代理认证处理器
   */
  _removeAuthHandler() {
    if (this.authHandler) {
      try {
        chrome.webRequest.onAuthRequired.removeListener(this.authHandler);
      } catch {}
      this.authHandler = null;
    }
  }

  /**
   * 清除代理设置
   */
  async clearProxy() {
    this._removeAuthHandler();
    this.currentProxy = null;

    try {
      await chrome.proxy.settings.clear({ scope: 'regular' });
      _log(`[ProxyManager] 代理已清除`);
    } catch (e) {
      _warn(`[ProxyManager] 清除代理失败:`, e.message);
    }
  }

  /**
   * 通过代理 IP 查询地理位置
   * 使用免费 API: ip-api.com
   * @param {string} proxyHost 代理主机地址
   * @returns {{ countryCode: string, timezone: string, lang: string }}
   */
  async getGeoLocation(proxyHost) {
    // 检查缓存
    if (this.geoCache.has(proxyHost)) {
      return this.geoCache.get(proxyHost);
    }

    try {
      const response = await fetch(
        `http://ip-api.com/json/${proxyHost}?fields=countryCode,timezone,query`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (!response.ok) {
        throw new Error(`IP 查询失败 (${response.status})`);
      }

      const data = await response.json();
      const geoInfo = {
        countryCode: data.countryCode || '',
        timezone: data.timezone || '',
        ip: data.query || proxyHost,
      };

      // 缓存结果
      this.geoCache.set(proxyHost, geoInfo);
      _log(`[ProxyManager] IP 地理位置: ${proxyHost} -> ${geoInfo.countryCode} (${geoInfo.timezone})`);

      return geoInfo;
    } catch (e) {
      _warn(`[ProxyManager] IP 地理位置查询失败:`, e.message);
      return null;
    }
  }
}
