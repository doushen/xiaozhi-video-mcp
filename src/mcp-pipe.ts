/**
 * @fileoverview MCP 管道程序
 * @description 连接 xiaozhi.me 平台 WebSocket 和本地 MCP Server 的桥梁
 *
 * 使用方式：
 *   export MCP_ENDPOINT=wss://api.xiaozhi.me/mcp/?token=xxx
 *   npm run dev
 *
 * 架构：
 *   xiaozhi.me 平台 <--WebSocket--> mcp_pipe <--stdio--> MCP Server
 */

import WebSocket from 'ws';
import { spawn, ChildProcess } from 'child_process';

// ============================================================
// 配置
// ============================================================

/** 重连初始等待时间（秒） */
const INITIAL_BACKOFF = 1;

/** 最大等待时间（秒） */
const MAX_BACKOFF = 600;

/** 日志前缀 */
const LOG_PREFIX = '[MCPPipe]';

// ============================================================
// 日志函数
// ============================================================

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`${timestamp} ${LOG_PREFIX} [${level.toUpperCase()}] ${message}`);
}

// ============================================================
// 主程序
// ============================================================

async function main(): Promise<void> {
  // 获取 WebSocket 端点
  const endpoint = process.env.MCP_ENDPOINT;

  if (!endpoint) {
    log('error', '请设置环境变量 MCP_ENDPOINT');
    log('error', '示例: export MCP_ENDPOINT=wss://api.xiaozhi.me/mcp/?token=xxx');
    process.exit(1);
  }

  log('info', `配置端点: ${endpoint.replace(/token=[^&]+/, 'token=***')}`);

  // 启动连接
  await connectWithRetry(endpoint);
}

/**
 * 带重试机制的连接
 */
async function connectWithRetry(uri: string): Promise<void> {
  let reconnectAttempt = 0;
  let backoff = INITIAL_BACKOFF;

  while (true) {
    try {
      if (reconnectAttempt > 0) {
        log('info', `等待 ${backoff}s 后进行第 ${reconnectAttempt} 次重连...`);
        await sleep(backoff * 1000);
      }

      await connectToServer(uri);

    } catch (error) {
      reconnectAttempt++;
      log('warn', `连接断开 (第 ${reconnectAttempt} 次): ${error}`);
      // 指数退避
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}

/**
 * 连接到服务器
 */
async function connectToServer(uri: string): Promise<void> {
  log('info', '正在连接到 WebSocket 服务器...');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(uri);
    let serverProcess: ChildProcess | null = null;
    let isClosing = false;

    // ============================================================
    // WebSocket 事件
    // ============================================================

    ws.on('open', () => {
      log('info', 'WebSocket 连接成功');

      // 启动 MCP Server 进程
      serverProcess = spawnMcpServer();

      // 设置数据管道
      setupPipes(ws, serverProcess);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      const message = data.toString();
      log('info', `收到消息: ${truncate(message, 120)}`);

      // 转发到 MCP Server 的 stdin
      if (serverProcess?.stdin?.writable) {
        serverProcess.stdin.write(message + '\n');
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      log('warn', `WebSocket 关闭: ${code} - ${reason.toString()}`);
      cleanup();

      if (!isClosing) {
        reject(new Error(`WebSocket 关闭: ${code}`));
      }
    });

    ws.on('error', (error: Error) => {
      log('error', `WebSocket 错误: ${error.message}`);
      cleanup();
      reject(error);
    });

    // ============================================================
    // 清理函数
    // ============================================================

    function cleanup() {
      if (serverProcess) {
        log('info', '终止 MCP Server 进程');
        serverProcess.kill();
        serverProcess = null;
      }
    }
  });
}

/**
 * 启动 MCP Server 进程
 */
function spawnMcpServer(): ChildProcess {
  log('info', '启动 MCP Server 进程...');

  // 使用 tsx 运行 TypeScript
  const childProcess = spawn('npx', ['tsx', 'src/video-server.ts'], {
    cwd: globalThis.process.cwd(),
    env: globalThis.process.env,
    stdio: ['pipe', 'pipe', 'inherit'] // stdin, stdout, stderr
  });

  childProcess.on('error', (error) => {
    log('error', `MCP Server 进程错误: ${error.message}`);
  });

  childProcess.on('exit', (code, signal) => {
    log('warn', `MCP Server 进程退出: code=${code}, signal=${signal}`);
  });

  return childProcess;
}

/**
 * 设置数据管道
 */
function setupPipes(ws: WebSocket, serverProcess: ChildProcess): void {
  if (!serverProcess.stdout) {
    log('error', 'MCP Server stdout 不可用');
    return;
  }

  // MCP Server stdout -> WebSocket
  serverProcess.stdout.on('data', (data: Buffer) => {
    const message = data.toString().trim();
    if (message) {
      log('info', `发送消息: ${truncate(message, 120)}`);
      ws.send(message);
    }
  });

  serverProcess.stdout.on('error', (error: Error) => {
    log('error', `stdout 错误: ${error.message}`);
  });

  // MCP Server stdin 错误处理
  serverProcess.stdin?.on('error', (error: Error) => {
    log('error', `stdin 错误: ${error.message}`);
  });
}

/**
 * 工具函数：休眠
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 工具函数：截断字符串
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '...';
}

// ============================================================
// 启动
// ============================================================

// 信号处理
process.on('SIGINT', () => {
  log('info', '收到中断信号，正在关闭...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('info', '收到终止信号，正在关闭...');
  process.exit(0);
});

// 未捕获异常
process.on('uncaughtException', (error: Error) => {
  log('error', `未捕获异常: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  log('error', `未处理的 Promise 拒绝: ${reason}`);
});

// 启动主程序
main();