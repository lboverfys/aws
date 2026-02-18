#!/usr/bin/env node
/**
 * Native Messaging Host - xray-core 进程管理器
 * 通过 Chrome Native Messaging 协议与扩展通信
 * 管理多个 xray-core 实例（每个注册会话一个）
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// xray 可执行文件路径
const XRAY_PATH = path.join(__dirname, 'xray', 'xray.exe');

// 活跃的 xray 进程 Map<sessionId, { process, port, configPath }>
const instances = new Map();

// 临时配置文件目录
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ============== Native Messaging 协议 ==============

/**
 * 从 stdin 读取消息（length-prefixed JSON）
 */
function readMessage() {
  return new Promise((resolve, reject) => {
    // 读取 4 字节长度前缀
    const header = Buffer.alloc(4);
    let headerRead = 0;

    const onReadable = () => {
      while (headerRead < 4) {
        const chunk = process.stdin.read(4 - headerRead);
        if (!chunk) return;
        chunk.copy(header, headerRead);
        headerRead += chunk.length;
      }

      // 解析消息长度
      const length = header.readUInt32LE(0);
      if (length === 0 || length > 1024 * 1024) {
        reject(new Error(`Invalid message length: ${length}`));
        return;
      }

      // 读取消息体
      let body = Buffer.alloc(0);
      const readBody = () => {
        while (body.length < length) {
          const chunk = process.stdin.read(length - body.length);
          if (!chunk) return;
          body = Buffer.concat([body, chunk]);
        }
        process.stdin.removeListener('readable', readBody);
        try {
          resolve(JSON.parse(body.toString('utf8')));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      };

      process.stdin.removeListener('readable', onReadable);
      process.stdin.on('readable', readBody);
      readBody();
    };

    process.stdin.on('readable', onReadable);
    onReadable();
  });
}
/**
 * 发送消息到 stdout（length-prefixed JSON）
 */
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

/**
 * 查找可用端口
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * 等待端口可连接（验证 xray 已启动）
 */
function waitForPort(port, timeout = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`端口 ${port} 等待超时`));
        return;
      }
      const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

// ============== xray 进程管理 ==============

/**
 * 启动 xray 实例
 */
async function startProxy(sessionId, xrayConfig) {
  // 如果已有实例，先停止
  if (instances.has(sessionId)) {
    await stopProxy(sessionId);
  }

  // 分配端口
  const port = await findFreePort();
  xrayConfig.inbounds[0].port = port;

  // 写入临时配置文件
  const configPath = path.join(TEMP_DIR, `${sessionId}.json`);
  fs.writeFileSync(configPath, JSON.stringify(xrayConfig, null, 2), 'utf8');

  // 启动 xray
  const proc = spawn(XRAY_PATH, ['run', '-c', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let stderr = '';
  proc.stderr.on('data', (data) => { stderr += data.toString(); });
  proc.on('error', (err) => {
    log(`[${sessionId}] xray 启动错误: ${err.message}`);
    cleanup(sessionId);
  });
  proc.on('exit', (code) => {
    log(`[${sessionId}] xray 退出, code=${code}`);
    cleanup(sessionId);
  });

  instances.set(sessionId, { process: proc, port, configPath });

  // 等待端口就绪
  try {
    await waitForPort(port, 10000);
  } catch {
    // 启动失败，清理
    proc.kill();
    cleanup(sessionId);
    throw new Error(`xray 启动失败: ${stderr.slice(0, 200)}`);
  }

  return { port };
}
/**
 * 停止指定会话的 xray 实例
 */
async function stopProxy(sessionId) {
  const instance = instances.get(sessionId);
  if (!instance) return;

  try {
    instance.process.kill();
  } catch {}
  cleanup(sessionId);
}

/**
 * 停止所有 xray 实例
 */
async function stopAll() {
  for (const [id] of instances) {
    await stopProxy(id);
  }
}

/**
 * 清理实例资源
 */
function cleanup(sessionId) {
  const instance = instances.get(sessionId);
  if (!instance) return;

  // 删除临时配置文件
  try {
    if (fs.existsSync(instance.configPath)) {
      fs.unlinkSync(instance.configPath);
    }
  } catch {}

  instances.delete(sessionId);
}

/**
 * 检查 xray 是否存在
 */
function checkXray() {
  return fs.existsSync(XRAY_PATH);
}

function log(msg) {
  fs.appendFileSync(
    path.join(__dirname, 'host.log'),
    `[${new Date().toISOString()}] ${msg}\n`
  );
}

// ============== 主循环 ==============

async function main() {
  log('Native host 启动');

  // Chrome 断开时（stdin 关闭）自动清理
  process.stdin.on('end', async () => {
    log('stdin 关闭，清理所有实例');
    await stopAll();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stopAll();
    process.exit(0);
  });

  while (true) {
    try {
      const msg = await readMessage();
      log(`收到命令: ${msg.command}, sessionId: ${msg.sessionId || 'N/A'}`);

      let response;
      switch (msg.command) {
        case 'start_proxy':
          try {
            const result = await startProxy(msg.sessionId, msg.xrayConfig);
            response = { success: true, port: result.port, sessionId: msg.sessionId };
          } catch (e) {
            response = { success: false, error: e.message, sessionId: msg.sessionId };
          }
          break;

        case 'stop_proxy':
          await stopProxy(msg.sessionId);
          response = { success: true, sessionId: msg.sessionId };
          break;

        case 'stop_all':
          await stopAll();
          response = { success: true };
          break;

        case 'check_xray':
          response = { success: true, available: checkXray(), path: XRAY_PATH };
          break;

        default:
          response = { success: false, error: `未知命令: ${msg.command}` };
      }

      sendMessage(response);
    } catch (e) {
      log(`错误: ${e.message}`);
      try {
        sendMessage({ success: false, error: e.message });
      } catch {
        // stdout 可能已关闭
        break;
      }
    }
  }
}

main().catch(e => {
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
