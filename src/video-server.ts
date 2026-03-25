/**
 * @fileoverview 视频播放 MCP Server + Web 播放器
 * @description MCP Server 通过 stdio 通信，同时启动 Web 播放页面
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';

// ============================================================
// 配置
// ============================================================

const HTTP_PORT = 3000;
const WS_PORT = 3001;

/** 默认测试视频 - 钢铁侠预告片 */
const DEFAULT_VIDEO = 'https://media.w3.org/2010/05/sintel/trailer.mp4';

function log(level: string, message: string): void {
  console.error(`[${new Date().toISOString()}] [${level}] ${message}`);
}

// ============================================================
// WebSocket 客户端管理
// ============================================================

const clients = new Set<WebSocket>();

// ============================================================
// Web 播放器页面 HTML
// ============================================================

const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>小智视频播放器</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      color: #fff;
    }
    h1 { margin-bottom: 20px; font-size: 1.8rem; }
    .status {
      padding: 10px 20px;
      border-radius: 20px;
      margin-bottom: 20px;
      font-size: 0.9rem;
    }
    .status.connected { background: #00b894; }
    .status.disconnected { background: #d63031; }
    .video-container {
      width: 100%;
      max-width: 900px;
      background: #000;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    video { width: 100%; display: block; background: #000; min-height: 400px; }
    .info { margin-top: 15px; text-align: center; opacity: 0.7; }
    .log {
      margin-top: 20px;
      width: 100%;
      max-width: 900px;
      max-height: 200px;
      overflow-y: auto;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      padding: 15px;
      font-family: monospace;
      font-size: 0.85rem;
    }
    .log-item { margin: 5px 0; opacity: 0.8; }
    .log-item.info { color: #74b9ff; }
    .log-item.error { color: #ff7675; }
    .log-item.success { color: #55efc4; }
  </style>
</head>
<body>
  <h1>🎬 小智视频播放器</h1>
  <div id="status" class="status disconnected">未连接</div>

  <div class="video-container">
    <video id="video" controls muted playsinline>
      <source src="" type="video/mp4">
      您的浏览器不支持视频播放
    </video>
  </div>

  <div class="info" id="info">点击页面任意位置激活音频，等待播放指令...</div>

  <div class="log" id="log"></div>

  <script>
    const video = document.getElementById('video');
    const statusEl = document.getElementById('status');
    const infoEl = document.getElementById('info');
    const logEl = document.getElementById('log');

    let ws;
    let audioUnlocked = false;

    // 点击页面解锁音频
    document.body.addEventListener('click', () => {
      if (!audioUnlocked) {
        video.muted = false;
        audioUnlocked = true;
        addLog('音频已激活，可以正常播放声音', 'success');
      }
    }, { once: false });

    function addLog(message, type = 'info') {
      const item = document.createElement('div');
      item.className = 'log-item ' + type;
      item.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
      logEl.appendChild(item);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function connect() {
      const wsUrl = 'ws://localhost:${WS_PORT}';
      addLog('连接: ' + wsUrl);

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        statusEl.textContent = '已连接';
        statusEl.className = 'status connected';
        addLog('WebSocket 连接成功', 'success');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addLog('收到指令: ' + JSON.stringify(data), 'info');
          handleCommand(data);
        } catch (e) {
          addLog('解析失败: ' + event.data, 'error');
        }
      };

      ws.onclose = () => {
        statusEl.textContent = '连接断开';
        statusEl.className = 'status disconnected';
        addLog('WebSocket 断开，5秒后重连', 'error');
        setTimeout(connect, 5000);
      };

      ws.onerror = () => addLog('WebSocket 错误', 'error');
    }

    function handleCommand(data) {
      if (data.type === 'play') {
        playVideo(data.video_path, data.volume);
      } else if (data.type === 'pause') {
        video.pause();
        infoEl.textContent = '已暂停';
        addLog('暂停', 'info');
      } else if (data.type === 'resume') {
        video.play();
        infoEl.textContent = audioUnlocked ? '播放中...' : '播放中... (静音模式)';
        addLog(audioUnlocked ? '恢复播放' : '恢复播放 (静音模式，点击页面激活音频)', 'success');
      }
    }

    function playVideo(src, volume = 1) {
      video.src = src;
      // 如果音频未解锁，保持静音
      if (!audioUnlocked) {
        video.muted = true;
        addLog('提示: 点击页面可激活音频', 'info');
      } else {
        video.muted = false;
        video.volume = volume;
      }
      video.play().then(() => {
        infoEl.textContent = '播放: ' + src;
        addLog('播放: ' + src, 'success');
      }).catch(err => {
        infoEl.textContent = '播放失败: ' + err.message;
        addLog('播放失败: ' + err.message, 'error');
      });
    }

    video.onended = () => {
      infoEl.textContent = '播放结束';
      addLog('播放结束', 'info');
    };

    connect();
  </script>
</body>
</html>`;

// ============================================================
// 启动 HTTP + WebSocket 服务器
// ============================================================

function startWebServer(): void {
  // HTTP 服务器
  const httpServer = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  httpServer.listen(HTTP_PORT, () => {
    log('INFO', `Web 播放器: http://localhost:${HTTP_PORT}`);
  });

  // WebSocket 服务器
  const wsServer = new WebSocketServer({ port: WS_PORT });

  wsServer.on('connection', (ws) => {
    log('INFO', 'Web 客户端连接');
    clients.add(ws);

    ws.on('close', () => {
      clients.delete(ws);
      log('INFO', 'Web 客户端断开');
    });
  });

  log('INFO', `WebSocket 服务: ws://localhost:${WS_PORT}`);
}

// ============================================================
// 广播函数
// ============================================================

function broadcastPlay(videoPath: string, volume: number = 1): number {
  const message = JSON.stringify({
    type: 'play',
    video_path: videoPath,
    volume
  });

  let count = 0;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      count++;
    }
  }

  log('INFO', `广播播放指令到 ${count} 个客户端: ${videoPath}`);
  return count;
}

function broadcastPause(): void {
  const message = JSON.stringify({ type: 'pause' });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function broadcastResume(): void {
  const message = JSON.stringify({ type: 'resume' });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ============================================================
// 播放状态
// ============================================================

let currentState = {
  playing: false,
  videoPath: null as string | null,
  currentTime: 0,
  duration: 0,
  volume: 1
};

// ============================================================
// 创建 MCP Server
// ============================================================

const server = new McpServer({
  name: 'xiaozhi-video-server',
  version: '1.0.0'
});

// play_video 工具
server.tool(
  'play_video',
  '播放视频。当用户说"播放视频"、"看视频"或提供视频地址时调用此工具。不传参数则播放默认测试视频。',
  {
    video_path: z.string().optional().describe('视频文件的路径或在线地址，不传则播放默认视频'),
    autoplay: z.boolean().optional().default(true).describe('是否自动播放'),
    volume: z.number().min(0).max(1).optional().default(1).describe('音量 (0-1)')
  },
  async ({ video_path, autoplay = true, volume = 1 }) => {
    // 如果没传视频路径，使用默认视频
    const actualVideoPath = video_path || DEFAULT_VIDEO;

    log('INFO', `播放视频: ${actualVideoPath}`);

    currentState = {
      playing: autoplay,
      videoPath: actualVideoPath,
      currentTime: 0,
      duration: 0,
      volume
    };

    // 广播到 Web 播放器
    const clientCount = broadcastPlay(actualVideoPath, volume);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: `视频播放已触发: ${actualVideoPath}`,
            videoPath: actualVideoPath,
            isDefault: !video_path,
            webClients: clientCount,
            state: currentState
          }, null, 2)
        }
      ]
    };
  }
);

// pause_video 工具
server.tool(
  'pause_video',
  '暂停视频播放。当用户说"暂停"、"停止播放"、"别放了"等时调用此工具。',
  {},
  async () => {
    log('INFO', '暂停视频');

    if (!currentState.videoPath) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            message: '当前没有正在播放的视频'
          }, null, 2)
        }]
      };
    }

    currentState.playing = false;
    broadcastPause();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          message: '视频已暂停',
          videoPath: currentState.videoPath
        }, null, 2)
      }]
    };
  }
);

// resume_video 工具
server.tool(
  'resume_video',
  '继续播放视频。当用户说"继续播放"、"恢复"、"接着放"等时调用此工具。',
  {},
  async () => {
    log('INFO', '恢复播放');

    if (!currentState.videoPath) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            message: '当前没有可恢复的视频'
          }, null, 2)
        }]
      };
    }

    currentState.playing = true;
    broadcastResume();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          message: '视频已恢复播放',
          videoPath: currentState.videoPath
        }, null, 2)
      }]
    };
  }
);

// get_video_state 工具
server.tool(
  'get_video_state',
  '获取当前视频播放状态。当用户询问"视频状态"、"播放到哪了"等时调用此工具。',
  {},
  async () => {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          state: currentState
        }, null, 2)
      }]
    };
  }
);

// play_default_video 工具 - 播放默认测试视频
server.tool(
  'play_default_video',
  '播放默认测试视频。当用户说"播放视频"但没有指定具体视频时调用此工具。',
  {},
  async () => {
    log('INFO', `播放默认视频: ${DEFAULT_VIDEO}`);

    currentState = {
      playing: true,
      videoPath: DEFAULT_VIDEO,
      currentTime: 0,
      duration: 0,
      volume: 1
    };

    // 广播到 Web 播放器
    const clientCount = broadcastPlay(DEFAULT_VIDEO, 1);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          message: '默认视频播放已触发',
          videoPath: DEFAULT_VIDEO,
          webClients: clientCount,
          state: currentState
        }, null, 2)
      }]
    };
  }
);

// ============================================================
// 主函数
// ============================================================

async function main() {
  // 启动 Web 服务器
  startWebServer();

  // 启动 MCP Server
  log('INFO', '启动 MCP Server...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('INFO', 'MCP Server 已启动');
  log('INFO', `请在浏览器打开: http://localhost:${HTTP_PORT}`);
}

main().catch((error) => {
  log('ERROR', `启动失败: ${error}`);
  process.exit(1);
});