// SuQCanvas LAN collaboration server
// Run: npm run lan (PORT and LAN_DATA_DIR can be overridden with environment variables)

import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
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
/** @type {Map<string, { meta: any, total: number, chunks: Array<string | null> }>} */
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
  if (pending.chunks[index] === null) pending.chunks[index] = String(msg.data ?? '')
  if (pending.chunks.some((chunk) => chunk === null)) return

  pendingAssets.delete(key)
  try {
    const paths = assetPaths(assetId)
    const bytes = Buffer.from(pending.chunks.join(''), 'base64')
    await Promise.all([
      writeFile(paths.data, bytes),
      writeFile(paths.meta, JSON.stringify({ ...pending.meta, id: assetId }), 'utf8'),
    ])
    requestedAssets.delete(assetId)
  } catch (error) {
    requestedAssets.delete(assetId)
    console.warn('[SuQCanvas LAN] Failed to cache asset:', error)
  }
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
      setTimeout(() => requestedAssets.delete(assetId), 10000)
    }
  }
}

async function sendCachedAsset(ws, assetId) {
  if (!isSafeId(assetId)) return false
  try {
    const paths = assetPaths(assetId)
    const [meta, bytes] = await Promise.all([
      readFile(paths.meta, 'utf8').then(JSON.parse),
      readFile(paths.data),
    ])
    const total = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE))
    sendTo(ws, { t: 'asset-meta', asset: meta, totalChunks: total, from: 'server' })
    for (let index = 0; index < total; index++) {
      const chunk = bytes.subarray(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
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
        pendingAssets.set(`${info.id}:${asset.id}`, {
          meta: asset,
          total,
          chunks: new Array(total).fill(null),
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
      if (key.startsWith(`${info.id}:`)) pendingAssets.delete(key)
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
