/**
 * Xray-core 配置生成器
 * 根据节点信息生成 xray JSON 配置
 */

/**
 * 生成 xray-core 配置
 * @param {Object} node 节点信息（来自 subscription-parser）
 * @param {number} localPort 本地 SOCKS5 监听端口
 * @returns {Object} xray JSON 配置
 */
export function generateXrayConfig(node, localPort) {
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [{
      tag: 'socks-in',
      protocol: 'socks',
      listen: '127.0.0.1',
      port: localPort,
      settings: { auth: 'noauth', udp: true }
    }],
    outbounds: [buildOutbound(node)],
    dns: {
      servers: ['8.8.8.8', '1.1.1.1']
    }
  };
  return config;
}

/**
 * 生成 SOCKS5 代理的 xray 配置
 * 用于 SOCKS5 带认证的场景（Chrome 无法原生处理 SOCKS5 认证）
 * @param {{ host: string, port: number, username: string, password: string }} proxyInfo
 * @param {number} localPort 本地监听端口（由 native host 分配时传 0）
 * @returns {Object} xray JSON 配置
 */
export function generateSocks5XrayConfig(proxyInfo, localPort) {
  const { host, port, username, password } = proxyInfo;
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [{
      tag: 'socks-in',
      protocol: 'socks',
      listen: '127.0.0.1',
      port: localPort,
      settings: { auth: 'noauth', udp: true }
    }],
    outbounds: [{
      tag: 'proxy',
      protocol: 'socks',
      settings: {
        servers: [{
          address: host,
          port: port,
          users: (username && password) ? [{
            user: username,
            pass: password
          }] : undefined
        }]
      }
    }],
    dns: {
      servers: ['8.8.8.8', '1.1.1.1']
    }
  };
  return config;
}

function buildOutbound(node) {
  switch (node.protocol) {
    case 'vless': return buildVless(node);
    case 'vmess': return buildVmess(node);
    case 'trojan': return buildTrojan(node);
    case 'shadowsocks': return buildShadowsocks(node);
    case 'hysteria2': return buildHysteria2(node);
    default: throw new Error(`不支持的协议: ${node.protocol}`);
  }
}
function buildStreamSettings(node) {
  const stream = { network: node.transport || 'tcp' };

  // TLS / Reality
  if (node.security === 'tls') {
    stream.security = 'tls';
    stream.tlsSettings = {
      serverName: node.sni || node.host,
      fingerprint: node.fingerprint || 'chrome',
      allowInsecure: false,
    };
    if (node.alpn) {
      stream.tlsSettings.alpn = node.alpn.split(',');
    }
  } else if (node.security === 'reality') {
    stream.security = 'reality';
    stream.realitySettings = {
      serverName: node.sni || node.host,
      fingerprint: node.fingerprint || 'chrome',
      publicKey: node.pbk || '',
      shortId: node.sid || '',
      spiderX: node.spx || '',
    };
  }

  // Transport
  if (stream.network === 'ws') {
    stream.wsSettings = {
      path: node.path || '/',
      headers: { Host: node.wsHost || node.sni || node.host }
    };
  } else if (stream.network === 'grpc') {
    stream.grpcSettings = {
      serviceName: node.serviceName || '',
      multiMode: false
    };
  } else if (stream.network === 'h2' || stream.network === 'http') {
    stream.network = 'h2';
    stream.httpSettings = {
      host: [node.sni || node.host],
      path: node.path || '/'
    };
  }

  return stream;
}

function buildVless(node) {
  const outbound = {
    tag: 'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: node.host,
        port: node.port,
        users: [{
          id: node.uuid,
          encryption: 'none',
          flow: node.flow || ''
        }]
      }]
    },
    streamSettings: buildStreamSettings(node)
  };
  return outbound;
}
function buildVmess(node) {
  return {
    tag: 'proxy',
    protocol: 'vmess',
    settings: {
      vnext: [{
        address: node.host,
        port: node.port,
        users: [{
          id: node.uuid,
          alterId: node.alterId || 0,
          security: 'auto'
        }]
      }]
    },
    streamSettings: buildStreamSettings(node)
  };
}

function buildTrojan(node) {
  return {
    tag: 'proxy',
    protocol: 'trojan',
    settings: {
      servers: [{
        address: node.host,
        port: node.port,
        password: node.password
      }]
    },
    streamSettings: buildStreamSettings(node)
  };
}

function buildShadowsocks(node) {
  return {
    tag: 'proxy',
    protocol: 'shadowsocks',
    settings: {
      servers: [{
        address: node.host,
        port: node.port,
        method: node.method,
        password: node.password
      }]
    },
    streamSettings: { network: 'tcp' }
  };
}

function buildHysteria2(node) {
  return {
    tag: 'proxy',
    protocol: 'hysteria2',
    settings: {
      servers: [{
        address: node.host,
        port: node.port,
        password: node.password
      }]
    },
    streamSettings: {
      security: 'tls',
      tlsSettings: {
        serverName: node.sni || node.host,
        allowInsecure: node.insecure || false
      }
    }
  };
}
