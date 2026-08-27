// SuQCanvas LAN collaboration server
// Run: npm run lan (PORT and LAN_DATA_DIR can be overridden with environment variables)

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = Number(process.env.PORT || 8790)
const serverDir = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(process.env.LAN_DATA_DIR || join(serverDir, 'data'))
const PROJECTS_FILE = join(DATA_DIR, 'projects.json')
const ASSETS_DIR = join(DATA_DIR, 'assets')
const WEB_ROOT = resolve(process.env.LAN_WEB_ROOT || join(serverDir, '..', 'dist-lan'))
const CHUNK_SIZE = 262143
const WEB_BASE = '/SuQCanvas/'
const USER_COLORS = [
  '#0284c7', '#ea580c', '#16a34a', '#e11d48', '#9333ea', '#ca8a04',
  '#0d9488', '#db2777', '#4f46e5', '#65a30d', '#dc2626', '#0891b2',
]

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

await mkdir(ASSETS_DIR, { recursive: true })

/** @type {Map<string, any>} */
const projects = new Map()
try {
  const saved = JSON.parse(await readFile(PROJECTS_FILE, 'utf8'))
  for (const project of Array.isArray(saved) ? saved : []) {
    if (isProject(project)) projects.set(project.id, project)
  }
} catch (error) {
  if (error?.code !== 'ENOENT') console.warn('[SuQCanvas LAN] Failed to load projects:', error)
}

let projectWrite = Promise.resolve()
function persistProjects() {
  const payload = JSON.stringify([...projects.values()], null, 2)
  projectWrite = projectWrite
    .catch(() => undefined)
    .then(() => writeFile(PROJECTS_FILE, payload, 'utf8'))
    .catch((error) => console.error('[SuQCanvas LAN] Failed to save projects:', error))
  return projectWrite
}

function isSafeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
}

function isProject(value) {
  return (
    value &&
    isSafeId(value.id) &&
    typeof value.name === 'string' &&
    value.graph &&
    Array.isArray(value.graph.nodes) &&
    Array.isArray(value.graph.edges)
  )
}

function normalizeProject(value) {
  if (!isProject(value)) return null
  const now = Date.now()
  const existing = projects.get(value.id)
  return {
    id: value.id,
    name: value.name.trim().slice(0, 120) || '未命名项目',
    createdAt: Number(value.createdAt) || existing?.createdAt || now,
    updatedAt: now,
    graph: { nodes: value.graph.nodes, edges: value.graph.edges },
    viewport: value.viewport || { x: 0, y: 0, zoom: 1 },
  }
}

function projectList() {
  return [...projects.values()]
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function assetKey(id) {
  return createHash('sha256').update(id).digest('hex')
}

function assetPaths(id) {
  const key = assetKey(id)
  return { meta: join(ASSETS_DIR, `${key}.json`), data: join(ASSETS_DIR, `${key}.bin`) }
}

// ---- 资产 HTTP 流式拉取（支持 Range，视频边下边播） ----

function parseRangeHeader(range, total) {
  if (typeof range !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) return null
  const [, startStr, endStr] = match
  let start = startStr === '' ? 0 : Number(startStr)
  let end = endStr === '' ? total - 1 : Number(endStr)
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (startStr === '' && endStr !== '') {
    // 后缀范围：最后 N 字节
    start = Math.max(0, total - end)
    end = total - 1
  }
  if (start >= total || end < start) return null
  return { start, end: Math.min(end, total - 1) }
}

function streamFile(filePath, start, end, res) {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start, end })
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500)
        res.end('Internal error')
      } else {
        res.destroy()
      }
    })
    stream.on('end', resolve)
    stream.pipe(res)
  })
}

async function serveAsset(req, res, assetId) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }
  const paths = assetPaths(assetId)
  let meta
  let fileStat
  try {
    ;[meta, fileStat] = await Promise.all([
      readFile(paths.meta, 'utf8').then(JSON.parse),
      stat(paths.data),
    ])
  } catch {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const total = fileStat.size
  const contentType = String(meta?.mime || 'application/octet-stream')
  const range = parseRangeHeader(req.headers.range, total)
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  }
  if (range) {
    const { start, end } = range
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${total}`,
    })
  } else {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': total })
  }
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  if (range) await streamFile(paths.data, range.start, range.end, res)
  else await streamFile(paths.data, 0, total - 1, res)
}

async function serveWeb(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
  } catch {
    res.writeHead(400)
    res.end('Bad request')
    return
  }

  if (pathname === '/') {
    res.writeHead(302, { Location: WEB_BASE })
    res.end()
    return
  }
  if (!pathname.startsWith(WEB_BASE)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  // 资产流式拉流：/SuQCanvas/assets/<assetId>（支持 Range，视频边下边播）。
  // 注意：Vite 构建的静态 JS/CSS 也位于 /SuQCanvas/assets/ 下（文件名带扩展名），
  // 仅当剩余路径是纯安全 ID（无点无斜杠）时才按资产处理，避免拦截静态资源。
  if (pathname.startsWith(`${WEB_BASE}assets/`)) {
    const rest = pathname.slice((WEB_BASE + 'assets/').length)
    if (rest && !rest.includes('/') && !rest.includes('.') && isSafeId(rest)) {
      await serveAsset(req, res, rest)
      return
    }
  }

  const relativePath = pathname.slice(WEB_BASE.length) || 'index.html'
  let filePath = resolve(WEB_ROOT, relativePath)
  if (filePath !== WEB_ROOT && !filePath.startsWith(`${WEB_ROOT}${sep}`)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  let content
  try {
    content = await readFile(filePath)
  } catch {
    if (extname(relativePath)) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    filePath = join(WEB_ROOT, 'index.html')
    try {
      content = await readFile(filePath)
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('SuQCanvas web files are missing. Run npm run build:lan first.')
      return
    }
  }

  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=86400',
  })
  if (req.method === 'HEAD') res.end()
  else res.end(content)
}

const httpServer = createServer((req, res) => void serveWeb(req, res))
const wss = new WebSocketServer({ server: httpServer })
httpServer.listen(PORT, '0.0.0.0')

/** @type {Map<import('ws').WebSocket, { id: string, name: string, ip: string, color: string, projectId: string | null }>} */
const clients = new Map()
/** @type {Map<string, { meta: any, total: number, handle: import('node:fs/promises').FileHandle | null, tmpPath: string | null, received: number, seen: Set<number>, writeChain: Promise<void> | undefined }>} */
const pendingAssets = new Map()
const requestedAssets = new Set()

function isOpen(ws) {
  return ws.readyState === WebSocket.OPEN
}

function sendTo(ws, obj) {
  if (isOpen(ws)) ws.send(JSON.stringify(obj))
}

function broadcast(obj, exceptWs, projectId) {
  const data = JSON.stringify(obj)
  for (const [peer, info] of clients) {
    if (peer === exceptWs || !isOpen(peer)) continue
    if (projectId !== undefined && info.projectId !== projectId) continue
    peer.send(data)
  }
}

function userList(projectId) {
  return [...clients.values()]
    .filter((client) => projectId === undefined || client.projectId === projectId)
    .map(({ id, name, ip, color, projectId: room }) => ({ id, name, ip, color, projectId: room }))
}

function nextUserColor() {
  const used = new Set([...clients.values()].map((client) => client.color))
  return USER_COLORS.find((color) => !used.has(color)) || USER_COLORS[clients.size % USER_COLORS.length]
}

function broadcastUsers() {
  for (const [peer, info] of clients) {
    sendTo(peer, { t: 'users', users: userList(info.projectId) })
  }
}

function sendProjectList(ws) {
  sendTo(ws, { t: 'project-list', projects: projectList() })
}

function broadcastProjectList() {
  broadcast({ t: 'project-list', projects: projectList() })
}

async function cacheAssetChunk(info, msg) {
  const assetId = String(msg.assetId ?? '')
  const key = `${info.id}:${assetId}`
  const pending = pendingAssets.get(key)
  if (!pending) return
  const index = Number(msg.index)
  if (!Number.isInteger(index) || index < 0 || index >= pending.total) return
  if (pending.seen.has(index)) return
  pending.seen.add(index)

  let buffer
  try {
    buffer = Buffer.from(String(msg.data ?? ''), 'base64')
  } catch {
    return
  }

  // 分片可能并发到达，open+write 串行执行，避免并发 open 同一 tmp 文件互相截断
  pending.writeChain = (pending.writeChain ?? Promise.resolve()).then(async () => {
    try {
      if (!pending.handle) {
        const paths = assetPaths(assetId)
        pending.tmpPath = `${paths.data}.tmp-${info.id}`
        pending.handle = await open(pending.tmpPath, 'w')
      }
      // 按 index 对应偏移写入，支持乱序到达，且不把整份资产攒在内存里
      await pending.handle.write(buffer, 0, buffer.length, index * CHUNK_SIZE)
      pending.received += 1
      if (pending.received < pending.total) return

      // 所有分块已落盘
      pendingAssets.delete(key)
      await pending.handle.sync().catch(() => undefined)
      await pending.handle.close()
      pending.handle = null
      const paths = assetPaths(assetId)
      await Promise.all([
        rename(pending.tmpPath, paths.data),
        writeFile(paths.meta, JSON.stringify({ ...pending.meta, id: assetId }), 'utf8'),
      ])
      requestedAssets.delete(assetId)
    } catch (error) {
      await pending.handle?.close().catch(() => undefined)
      pending.handle = null
      if (pending.tmpPath) await rm(pending.tmpPath, { force: true }).catch(() => undefined)
      pendingAssets.delete(key)
      requestedAssets.delete(assetId)
      console.warn('[SuQCanvas LAN] Failed to cache asset:', error)
    }
  }).catch(() => undefined)
}

async function requestMissingProjectAssets(ws, project) {
  const ids = new Set(
    project.graph.nodes
      .map((node) => node?.data?.assetId)
      .filter((id) => isSafeId(id)),
  )
  for (const assetId of ids) {
    if (requestedAssets.has(assetId)) continue
    const paths = assetPaths(assetId)
    try {
      await Promise.all([access(paths.meta), access(paths.data)])
    } catch {
      requestedAssets.add(assetId)
      sendTo(ws, { t: 'asset-request', assetId, from: 'server' })
      // 大视频传输可能超过 10s，超时过短会导致传输期间重复广播请求、产生并发传输流
      setTimeout(() => requestedAssets.delete(assetId), 60000)
    }
  }
}

async function sendCachedAsset(ws, assetId) {
  if (!isSafeId(assetId)) return false
  let handle
  try {
    const paths = assetPaths(assetId)
    const [meta, fileStat] = await Promise.all([
      readFile(paths.meta, 'utf8').then(JSON.parse),
      stat(paths.data),
    ])
    const total = Math.max(1, Math.ceil(fileStat.size / CHUNK_SIZE))
    // 视频类资产通知请求方可直接走 HTTP Range 流式拉取（无需整份 WebSocket 下载）
    if (String(meta.mime ?? '').startsWith('video/')) {
      sendTo(ws, { t: 'asset-http', assetId, url: `${WEB_BASE}assets/${assetId}`, from: 'server' })
    }
    sendTo(ws, { t: 'asset-meta', asset: meta, totalChunks: total, from: 'server' })
    // 分块流式读取发送，不再把整个文件读进内存，避免多客户端并发时内存翻倍
    handle = await open(paths.data, 'r')
    const buf = Buffer.allocUnsafe(CHUNK_SIZE)
    for (let index = 0; index < total; index++) {
      const { bytesRead } = await handle.read(buf, 0, CHUNK_SIZE, index * CHUNK_SIZE)
      if (bytesRead <= 0) break
      const chunk = bytesRead === CHUNK_SIZE ? buf : buf.subarray(0, bytesRead)
      sendTo(ws, {
        t: 'asset-chunk',
        assetId,
        index,
        total,
        data: chunk.toString('base64').replace(/=+$/, ''),
        from: 'server',
      })
    }
    return true
  } catch {
    return false
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

wss.on('connection', (ws, req) => {
  const forwarded = req.headers['x-forwarded-for']
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  const ip = (forwardedIp?.trim() || req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  const id = randomUUID()
  const info = { id, name: `设备-${id.slice(0, 4)}`, ip, color: nextUserColor(), projectId: null }
  clients.set(ws, info)

  sendTo(ws, { t: 'welcome', id, users: userList(null), projects: projectList() })
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
      sendProjectList(ws)
      broadcastUsers()
      return
    }

    if (msg.t === 'project-list-request') {
      sendProjectList(ws)
      return
    }

    if (msg.t === 'join-project') {
      const projectId = String(msg.projectId ?? '')
      if (!isSafeId(projectId)) return
      info.projectId = projectId
      const project = projects.get(projectId)
      sendTo(ws, { t: 'project-joined', projectId, exists: Boolean(project) })
      if (project) sendTo(ws, { t: 'project-data', project, from: 'server' })
      broadcast({ t: 'peer-joined', id: info.id }, ws, projectId)
      broadcastUsers()
      return
    }

    if (msg.t === 'leave-project') {
      const previousProjectId = info.projectId
      if (previousProjectId) broadcast({ t: 'leave', id: info.id }, ws, previousProjectId)
      info.projectId = null
      broadcastUsers()
      return
    }

    if (msg.t === 'project-save') {
      const project = normalizeProject(msg.project)
      if (!project) return
      projects.set(project.id, project)
      void persistProjects()
      void requestMissingProjectAssets(ws, project)
      sendTo(ws, { t: 'project-saved', projectId: project.id, updatedAt: project.updatedAt })
      broadcastProjectList()
      return
    }

    if (msg.t === 'project-delete') {
      const projectId = String(msg.projectId ?? '')
      if (!isSafeId(projectId) || !projects.delete(projectId)) return
      void persistProjects()
      for (const client of clients.values()) {
        if (client.projectId === projectId) client.projectId = null
      }
      broadcast({ t: 'project-deleted', projectId })
      broadcastProjectList()
      broadcastUsers()
      return
    }

    if (msg.t === 'project-data-request') {
      const projectId = String(msg.projectId ?? '')
      const project = projects.get(projectId)
      if (project) sendTo(ws, { t: 'project-data', project, from: 'server' })
      return
    }

    if (!info.projectId) return

    if (msg.t === 'asset-meta') {
      const asset = msg.asset
      const total = Number(msg.totalChunks)
      if (isSafeId(asset?.id) && Number.isInteger(total) && total > 0 && total <= 8192) {
        const key = `${info.id}:${asset.id}`
        const existing = pendingAssets.get(key)
        // 同源传输已在进行（meta 重发/续传场景）时保留已收分片，不重置
        if (existing && existing.total === total && existing.seen.size > 0) return
        // total 变化或全新传输：清理旧的未完成句柄与临时文件
        if (existing) {
          void existing.handle?.close().catch(() => undefined)
          void existing.writeChain?.catch(() => undefined)
          if (existing.tmpPath) void rm(existing.tmpPath, { force: true }).catch(() => undefined)
        }
        pendingAssets.set(key, {
          meta: asset,
          total,
          handle: null,
          tmpPath: null,
          received: 0,
          seen: new Set(),
          writeChain: undefined,
        })
      }
    }

    if (msg.t === 'asset-request') {
      const assetId = String(msg.assetId ?? '')
      void sendCachedAsset(ws, assetId).then((found) => {
        if (!found) broadcast({ ...msg, from: info.id }, ws, info.projectId)
      })
      return
    }

    if (
      msg.t === 'sync' ||
      msg.t === 'sync-del' ||
      msg.t === 'viewport' ||
      msg.t === 'cursor' ||
      msg.t === 'editing' ||
      msg.t === 'activity' ||
      msg.t === 'asset-meta' ||
      msg.t === 'asset-chunk'
    ) {
      msg.from = info.id
      msg.color = info.color
      if (msg.t === 'asset-chunk') void cacheAssetChunk(info, msg)
      const target = msg.to
        ? [...clients.entries()].find(([, client]) => client.id === msg.to && client.projectId === info.projectId)
        : null
      if (target) sendTo(target[0], msg)
      else if (msg.to !== 'server') broadcast(msg, ws, info.projectId)
    }
  })

  ws.on('close', () => {
    const projectId = info.projectId
    clients.delete(ws)
    for (const key of pendingAssets.keys()) {
      if (!key.startsWith(`${info.id}:`)) continue
      const pending = pendingAssets.get(key)
      if (pending?.handle) void pending.handle.close().catch(() => undefined)
      if (pending?.tmpPath) void rm(pending.tmpPath, { force: true }).catch(() => undefined)
      pendingAssets.delete(key)
    }
    if (projectId) broadcast({ t: 'leave', id: info.id }, undefined, projectId)
    broadcastUsers()
  })

  ws.on('error', () => ws.close())
})

console.log(`[SuQCanvas LAN] Server: http://0.0.0.0:${PORT}${WEB_BASE}`)
console.log(`[SuQCanvas LAN] Data: ${DATA_DIR}`)
const lanAddresses = Object.values(networkInterfaces())
  .flatMap((items) => items ?? [])
  .filter((item) => item.family === 'IPv4' && !item.internal)
  .map((item) => item.address)
if (lanAddresses.length) {
  console.log(`[SuQCanvas LAN] Open from other devices: ${lanAddresses.map((address) => `http://${address}:${PORT}${WEB_BASE}`).join(', ')}`)
}
