# 小智智能体 MCP 服务 (Xiaozhi Video MCP Server)

为小智智能体 (Xiaozhi Agent) 提供视频播放能力的 MCP 服务端。

## 系统架构

```
┌─────────────────┐      MCP Protocol      ┌─────────────────────┐      WebSocket      ┌──────────────────┐
│   小智智能体     │ ◄──────────────────────► │   xiaozhi.me 平台   │ ◄──────────────────► │    mcp-pipe      │
│ (Xiaozhi Agent) │      tools/call         │   (消息路由中心)     │      JSON-RPC       │   (管道程序)      │
└─────────────────┘                          └─────────────────────┘                      └────────┬─────────┘
                                                                                                     │ stdio
                                                                                                     ▼
                                                                                             ┌──────────────────┐
                                                                                             │  video-server    │
                                                                                             │  (MCP + Web)     │
                                                                                             └────────┬─────────┘
                                                                                                      │ WebSocket
                                                                                                      ▼
                                                                                             ┌──────────────────┐
                                                                                             │   Web 播放页面    │
                                                                                             │  (浏览器前端)     │
                                                                                             └──────────────────┘
```

## 功能特性

- ✅ 完整的 MCP 协议实现
- ✅ 视频播放工具：`play_video`、`pause_video`、`resume_video`、`get_video_state`
- ✅ Web 播放页面（自动打开浏览器）
- ✅ WebSocket 实时推送播放指令到前端
- ✅ 自动重连机制

## 环境要求

- Node.js >= 20.0.0

## 安装

```bash
# 进入项目目录
cd browserMCP

# 安装依赖
npm install
```

## 使用方法

### 1. 获取接入点

从 xiaozhi.me 平台获取 WebSocket 接入点 URL（包含 token）。

### 2. 配置环境变量

```bash
# 设置 WebSocket 接入点（必填）
export MCP_ENDPOINT="wss://api.xiaozhi.me/mcp/?token=YOUR_TOKEN_HERE"
```

### 3. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

### 4. 打开播放页面

服务启动后，在浏览器打开：**http://localhost:3000**

## 提供的工具

### 1. play_video

播放指定的视频文件。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| video_path | string | ✅ | 视频文件的路径或在线地址 |
| autoplay | boolean | ❌ | 是否自动播放，默认 true |
| volume | number | ❌ | 音量 (0-1)，默认 1 |

**示例：**

```json
{
  "name": "play_video",
  "arguments": {
    "video_path": "https://example.com/video.mp4",
    "volume": 0.8
  }
}
```

### 2. pause_video

暂停当前正在播放的视频。

### 3. resume_video

恢复播放已暂停的视频。

### 4. get_video_state

获取当前视频播放状态。

## 项目结构

```
browserMCP/
├── src/
│   ├── mcp-pipe.ts      # 管道程序（连接 xiaozhi.me 平台）
│   └── video-server.ts  # MCP Server + Web 播放服务
├── package.json
├── tsconfig.json
└── README.md
```

## 工作原理

1. **mcp-pipe.ts** 连接到 xiaozhi.me 平台的 WebSocket
2. 收到消息后，转发给 **video-server.ts** 的 stdin
3. **video-server.ts** 处理 MCP 协议请求
4. 当收到 `play_video` 调用时，通过 WebSocket 推送到 Web 播放页面
5. Web 页面接收指令，播放对应的视频

## 测试

```bash
# 测试 MCP Server（直接通过 stdio）
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | npx tsx src/video-server.ts
```

## 许可证

MIT