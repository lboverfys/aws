/**
 * 订阅链接解析器
 * 支持 vless, hysteria2, vmess, trojan, shadowsocks 协议
 */

/**
 * 请求订阅链接并解析节点列表
 * @param {string} url 订阅链接
 * @returns {Promise<Array>} 结构化节点数组
 */
export async function fetchSubscription(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'clash-verge/v1.5.0' }
  });
  if (!response.ok) {
    throw new Error(`订阅请求失败 (${response.status})`);
  }

  const text = await response.text();
  return parseSubscriptionText(text);
}

/**
 * 解析订阅文本（base64 或明文）
 */
export function parseSubscriptionText(text) {
  let decoded = text.trim();

  // 尝试 base64 解码
  try {
    const raw = atob(decoded);
    if (raw.includes('://')) {
      decoded = raw;
    }
  } catch {
    // 非 base64，使用原文
  }

  const lines = decoded.split(/[\r\n]+/).filter(l => l.trim() && l.includes('://'));
  const nodes = [];

  for (const line of lines) {
    try {
      const node = parseLine(line.trim());
      if (node) nodes.push(node);
    } catch {
      // 跳过无法解析的行
    }
  }

  return nodes;
}

/**
 * 解析单行节点 URI
 */
function parseLine(uri) {
  if (uri.startsWith('vless://')) return parseVless(uri);
  if (uri.startsWith('hysteria2://') || uri.startsWith('hy2://')) return parseHysteria2(uri);
  if (uri.startsWith('vmess://')) return parseVmess(uri);
  if (uri.startsWith('trojan://')) return parseTrojan(uri);
  if (uri.startsWith('ss://')) return parseShadowsocks(uri);
  return null;
}
/**
 * 解析 vless:// URI
 * vless://uuid@host:port?type=ws&security=tls&sni=xxx&path=/xxx#name
 */
function parseVless(uri) {
  const url = new URL(uri);
  const params = url.searchParams;
  return {
    protocol: 'vless',
    name: decodeURIComponent(url.hash.slice(1) || ''),
    uuid: url.username,
    host: url.hostname,
    port: parseInt(url.port) || 443,
    transport: params.get('type') || 'tcp',
    security: params.get('security') || 'none',
    sni: params.get('sni') || url.hostname,
    fingerprint: params.get('fp') || 'chrome',
    alpn: params.get('alpn') || '',
    path: params.get('path') || '/',
    serviceName: params.get('serviceName') || '',
    flow: params.get('flow') || '',
    // Reality 参数
    pbk: params.get('pbk') || '',
    sid: params.get('sid') || '',
    spx: params.get('spx') || '',
  };
}

/**
 * 解析 hysteria2:// URI
 * hysteria2://password@host:port?sni=xxx&insecure=1#name
 */
function parseHysteria2(uri) {
  const url = new URL(uri.replace('hy2://', 'hysteria2://'));
  const params = url.searchParams;
  return {
    protocol: 'hysteria2',
    name: decodeURIComponent(url.hash.slice(1) || ''),
    password: url.username,
    host: url.hostname,
    port: parseInt(url.port) || 443,
    sni: params.get('sni') || url.hostname,
    insecure: params.get('insecure') === '1',
    obfs: params.get('obfs') || '',
    obfsPassword: params.get('obfs-password') || '',
  };
}
/**
 * 解析 vmess:// URI (v2rayN 格式，base64 JSON)
 */
function parseVmess(uri) {
  const raw = uri.replace('vmess://', '');
  const json = JSON.parse(atob(raw));
  return {
    protocol: 'vmess',
    name: json.ps || '',
    uuid: json.id,
    host: json.add,
    port: parseInt(json.port) || 443,
    alterId: parseInt(json.aid) || 0,
    transport: json.net || 'tcp',
    security: json.tls === 'tls' ? 'tls' : 'none',
    sni: json.sni || json.host || json.add,
    path: json.path || '/',
    wsHost: json.host || '',
    fingerprint: json.fp || 'chrome',
    alpn: json.alpn || '',
  };
}

/**
 * 解析 trojan:// URI
 * trojan://password@host:port?sni=xxx&type=ws&path=/xxx#name
 */
function parseTrojan(uri) {
  const url = new URL(uri);
  const params = url.searchParams;
  return {
    protocol: 'trojan',
    name: decodeURIComponent(url.hash.slice(1) || ''),
    password: url.username,
    host: url.hostname,
    port: parseInt(url.port) || 443,
    transport: params.get('type') || 'tcp',
    sni: params.get('sni') || url.hostname,
    fingerprint: params.get('fp') || 'chrome',
    alpn: params.get('alpn') || '',
    path: params.get('path') || '/',
  };
}

/**
 * 解析 ss:// URI (SIP002 格式)
 * ss://base64(method:password)@host:port#name
 * ss://base64(method:password@host:port)#name
 */
function parseShadowsocks(uri) {
  const hashIdx = uri.indexOf('#');
  const name = hashIdx > -1 ? decodeURIComponent(uri.slice(hashIdx + 1)) : '';
  const main = hashIdx > -1 ? uri.slice(5, hashIdx) : uri.slice(5);

  // SIP002: base64@host:port
  if (main.includes('@')) {
    const [encoded, server] = main.split('@');
    const decoded = atob(encoded);
    const colonIdx = decoded.indexOf(':');
    const method = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);
    const [host, port] = server.split(':');
    return { protocol: 'shadowsocks', name, method, password, host, port: parseInt(port) || 443 };
  }

  // Legacy: base64(method:password@host:port)
  const decoded = atob(main);
  const match = decoded.match(/^(.+?):(.+?)@(.+?):(\d+)$/);
  if (match) {
    return { protocol: 'shadowsocks', name, method: match[1], password: match[2], host: match[3], port: parseInt(match[4]) };
  }

  return null;
}
