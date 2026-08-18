// SuQCanvas 局域网协作中继服务器
// 运行：npm run lan   （默认端口 8790，可用环境变量 PORT 覆盖）
// 各设备前端输入 ws://<本机局域网IP>:8790 即可加入协作
//
// 协议（文本 JSON 消息）：
//   客户端 → 服务端: { t: 'hello', name }
//   服务端 → 客户端: { t: 'welcome', id, users }
//   服务端 → 客户端: { t: 'users', users: [{ id, name, ip }] }
//   服务端 → 客户端: { t: 'leave', id }
//   任意转发:       sync / viewport / asset-meta / asset-request / asset-chunk（自动附加 from）
//   asset-chunk 支持定向 to 字段，只发给目标客户端

import { WebSocketServer, WebSocket } from 'ws'

const PORT = Number(process.env.PORT || 8790)

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' })

/** ws -> client info */
const clients = new Map()

function isOpen(ws) {
  return ws.readyState === WebSocket.OPEN
}

function sendTo(ws, obj) {
  if (isOpen(ws)) ws.send(JSON.stringify(obj))
}

function broadcast(obj, exceptWs) {
  const data = JSON.stringify(obj)
  for (const [ws] of clients) {
    if (ws === exceptWs) continue
    if (isOpen(ws)) ws.send(data)
  }
}

function userList() {
  return [...clients.values()].map((c) => ({ id: c.id, name: c.name, ip: c.ip }))
}

function broadcastUsers() {
  broadcast({ t: 'users', users: userList() })
}

wss.on('connection', (ws, req) => {
  const forwarded = req.headers['x-forwarded-for']
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  const ip = (forwardedIp?.trim() || req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  const id = crypto.randomUUID()
  const info = { id, name: `设备-${id.slice(0, 4)}`, ip }
  clients.set(ws, info)

  sendTo(ws, { t: 'welcome', id, users: userList() })
  broadcastUsers()

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!msg || typeof msg.t !== 'string') return

    if (msg.t === 'hello') {
      const name = String(msg.name ?? '').trim().slice(0, 30)
      if (name) info.name = name
      broadcastUsers()
      // 通知已在线的客户端有新设备加入，它们会把当前画布发给新设备
      broadcast({ t: 'peer-joined', id: info.id })
      return
    }

    if (
      msg.t === 'sync' ||
      msg.t === 'viewport' ||
      msg.t === 'asset-meta' ||
      msg.t === 'asset-request' ||
      msg.t === 'asset-chunk' ||
      msg.t === 'project-list' ||
      msg.t === 'project-data-request' ||
      msg.t === 'project-data'
    ) {
      msg.from = info.id
      const target = msg.to ? [...clients.entries()].find(([, c]) => c.id === msg.to) : null
      if (target) {
        sendTo(target[0], msg)
      } else {
        broadcast(msg, ws)
      }
      return
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    broadcast({ t: 'leave', id: info.id })
    broadcastUsers()
  })

  ws.on('error', () => {
    ws.close()
  })
})

console.log(`[SuQCanvas LAN] 中继服务器已启动: ws://0.0.0.0:${PORT}`)
console.log(`[SuQCanvas LAN] 使用 ipconfig/ifconfig 查看本机局域网 IP，其他设备连接 ws://<IP>:${PORT}`)
