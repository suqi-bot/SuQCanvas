import { db, type ProjectRecord } from '../db/db'
import { useCanvasStore } from '../store/canvasStore'
import { useLanStore, type LanUser } from '../store/lanStore'
import { toast } from '../store/uiStore'
import type { AssetMeta, SuqEdge, SuqNode } from '../types'
import type { Viewport } from '@xyflow/react'

// 分片大小取 3 的倍数，使每个分片的 base64 都对齐到字节边界，
// 各分片无填充 base64 拼接后才能精确还原原始数据
const CHUNK_SIZE = 262143 // 256KB - 1（262143 % 3 === 0）
const LAN_STORAGE_KEY = 'sq:lan'

interface LanMessage {
  t: string
  from?: string
  [k: string]: unknown
}

let ws: WebSocket | null = null
let applyingRemote = false
let syncTimer: ReturnType<typeof setTimeout> | null = null
let vpTimer: ReturnType<typeof setTimeout> | null = null

/** assetId -> 分片收集 */
interface PendingAsset {
  meta: AssetMeta
  total: number
  chunks: (string | null)[]
}
const pendingAssets = new Map<string, PendingAsset>()
const assetWaiters = new Map<string, Array<() => void>>()
const assetRequestsInFlight = new Set<string>()

/** projectId -> 项目数据等待者 */
const projectDataWaiters = new Map<string, Array<(rec: ProjectRecord | null) => void>>()

export function isLanConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN
}

function send(obj: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

export function lanConnect(url: string, name: string): void {
  if (ws) {
    ws.onclose = null
    ws.onerror = null
    ws.close()
    ws = null
  }
  const store = useLanStore.getState()
  store.setStatus('connecting')
  store.setUrl(url)
  store.setName(name)
  try {
    localStorage.setItem(LAN_STORAGE_KEY, JSON.stringify({ url, name }))
  } catch {
    // 忽略存储失败
  }

  let sock: WebSocket
  try {
    sock = new WebSocket(url)
  } catch {
    store.setStatus('error')
    toast('局域网连接地址无效', 'error')
    return
  }
  ws = sock

  sock.onopen = () => {
    useLanStore.setState({ status: 'connected', followId: null, remoteViewport: null })
    send({ t: 'hello', name })
    toast('已连接局域网协作', 'success')
    // 加入后请求当前画布引用的素材
    const nodes = useCanvasStore.getState().nodes
    for (const n of nodes) {
      if (n.data?.assetId) void requestAssetFromLan(n.data.assetId)
    }
  }

  sock.onclose = () => {
    if (ws === sock) ws = null
    useLanStore.setState({ status: 'idle', users: [], followId: null, remoteViewport: null })
    useLanStore.getState().clearRemoteProjects()
    toast('局域网连接已断开', 'error')
  }

  sock.onerror = () => {
    if (ws === sock) useLanStore.setState({ status: 'error' })
  }

  sock.onmessage = (ev) => {
    let msg: LanMessage
    try {
      msg = JSON.parse(ev.data as string)
    } catch {
      return
    }
    handleMessage(msg)
  }
}

export function lanDisconnect(): void {
  if (!ws) return
  try {
    localStorage.removeItem(LAN_STORAGE_KEY)
  } catch {
    // 忽略
  }
  ws.close()
}

/** 刷新页面后根据上次保存的地址自动重连 */
export function autoReconnectLan(): void {
  if (isLanConnected()) return
  try {
    const raw = localStorage.getItem(LAN_STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { url?: string; name?: string }
    if (saved?.url) lanConnect(saved.url, saved.name ?? '')
  } catch {
    // 忽略存储解析失败
  }
}

function handleMessage(msg: LanMessage): void {
  const lan = useLanStore.getState()
  switch (msg.t) {
    case 'welcome':
      lan.setSelfId(String(msg.id ?? ''))
      lan.setUsers((msg.users as LanUser[]) ?? [])
      void broadcastLocalProjects()
      break
    case 'peer-joined': {
      // 有新设备加入，把当前画布与项目列表定向发给它
      const targetId = String(msg.id ?? '')
      if (!targetId || targetId === lan.selfId) break
      const { nodes, edges } = useCanvasStore.getState()
      send({ t: 'sync', to: targetId, nodes: stripSelected(nodes), edges })
      void broadcastLocalProjects(targetId)
      break
    }
    case 'users':
      lan.setUsers((msg.users as LanUser[]) ?? [])
      break
    case 'leave': {
      const id = String(msg.id ?? '')
      lan.removeUser(id)
      lan.removeRemoteProjectsByOwner(id)
      break
    }
    case 'project-list': {
      const ownerId = String(msg.from ?? '')
      if (!ownerId) break
      const projects = ((msg.projects as Array<{ id?: string; name?: string; updatedAt?: number }>) ?? [])
        .filter((p) => p?.id)
        .map((p) => ({
          id: String(p.id),
          name: String(p.name ?? '未命名项目'),
          updatedAt: Number(p.updatedAt) || 0,
        }))
      lan.mergeRemoteProjects(ownerId, projects)
      break
    }
    case 'project-data-request': {
      const fromId = String(msg.from ?? '')
      const projectId = String(msg.projectId ?? '')
      if (!fromId || !projectId) break
      void (async () => {
        const rec = await db.projects.get(projectId)
        if (!rec) return
        send({
          t: 'project-data',
          to: fromId,
          project: {
            id: rec.id,
            name: rec.name,
            createdAt: rec.createdAt,
            updatedAt: rec.updatedAt,
            graph: rec.graph,
            viewport: rec.viewport,
          },
        })
      })()
      break
    }
    case 'project-data': {
      const project = msg.project as ProjectRecord | undefined
      if (!project?.id) break
      const waiters = projectDataWaiters.get(project.id)
      if (!waiters || waiters.length === 0) break
      projectDataWaiters.delete(project.id)
      void (async () => {
        try {
          await db.projects.put(project)
          for (const w of waiters) w(project)
        } catch {
          for (const w of waiters) w(null)
        }
      })()
      break
    }
    case 'sync': {
      if (msg.from === lan.selfId) return
      const nodes = (msg.nodes as SuqNode[]) ?? []
      const edges = (msg.edges as SuqEdge[]) ?? []
      applyingRemote = true
      try {
        // 保留本地选中状态，远端变更不触发选中闪烁
        const sel = new Set(useCanvasStore.getState().nodes.filter((n) => n.selected).map((n) => n.id))
        useCanvasStore.setState({
          nodes: nodes.map((n) => (sel.has(n.id) ? { ...n, selected: true } : n)),
          edges,
        })
      } finally {
        applyingRemote = false
      }
      // 远端节点引用的素材若本地缺失，向局域网拉取
      for (const n of nodes) {
        const assetId = n.data?.assetId
        if (!assetId) continue
        if (assetWaiters.has(assetId) || pendingAssets.has(assetId)) continue
        void db.assets.get(assetId).then((rec) => {
          if (!rec && assetWaiters.has(assetId) === false) void requestAssetFromLan(assetId)
        })
      }
      break
    }
    case 'viewport': {
      if (msg.from === lan.selfId) return
      if (lan.followId && msg.from === lan.followId) {
        lan.setRemoteViewport(msg.viewport as Viewport)
      }
      break
    }
    case 'asset-meta':
      receiveAssetMeta(msg)
      break
    case 'asset-chunk':
      receiveAssetChunk(msg)
      break
    case 'asset-request':
      void respondAssetRequest(msg)
      break
  }
}

// ---------- 画布同步 ----------

let lastSyncPayload: { nodes: SuqNode[]; edges: SuqEdge[]; viewport: Viewport } | null = null

function stripSelected(nodes: SuqNode[]): SuqNode[] {
  return nodes.map((n) => (n.selected ? { ...n, selected: false } : n))
}

function scheduleSyncBroadcast(): void {
  if (!isLanConnected() || applyingRemote) return
  const { nodes, edges, viewport } = useCanvasStore.getState()
  lastSyncPayload = { nodes, edges, viewport }
  if (syncTimer) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    const payload = lastSyncPayload
    lastSyncPayload = null
    if (!payload || !isLanConnected()) return
    send({
      t: 'sync',
      nodes: stripSelected(payload.nodes),
      edges: payload.edges,
    })
  }, 150)
}

function scheduleViewportBroadcast(): void {
  if (!isLanConnected() || applyingRemote) return
  const lan = useLanStore.getState()
  if (lan.followId) return // 跟随他人时不广播自己的视口
  if (vpTimer) return
  vpTimer = setTimeout(() => {
    vpTimer = null
    if (!isLanConnected()) return
    if (useLanStore.getState().followId) return
    send({ t: 'viewport', viewport: useCanvasStore.getState().viewport })
  }, 100)
}

export function initLanSync(): () => void {
  const unsub = useCanvasStore.subscribe((state, prev) => {
    if (state.nodes !== prev.nodes || state.edges !== prev.edges) {
      scheduleSyncBroadcast()
    }
    if (state.viewport !== prev.viewport) {
      scheduleViewportBroadcast()
    }
  })
  return unsub
}

// ---------- 项目同步 ----------

/** 广播本机项目元数据列表（可定向发给指定设备） */
export async function broadcastLocalProjects(toId?: string): Promise<void> {
  if (!isLanConnected()) return
  const projects = await db.projects.toArray()
  send({
    t: 'project-list',
    ...(toId ? { to: toId } : {}),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
    })),
  })
}

/** 从局域网获取项目数据，成功（写入本地 db）返回项目记录 */
export function fetchProjectFromLan(projectId: string): Promise<ProjectRecord | null> {
  return new Promise((resolve) => {
    if (!isLanConnected()) {
      resolve(null)
      return
    }
    const list = projectDataWaiters.get(projectId) ?? []
    list.push((rec) => resolve(rec))
    projectDataWaiters.set(projectId, list)
    send({ t: 'project-data-request', projectId })

    // 8s 超时
    setTimeout(() => {
      const pending = projectDataWaiters.get(projectId)
      if (pending && pending.length > 0) {
        pending.shift()
        if (pending.length === 0) projectDataWaiters.delete(projectId)
        resolve(null)
      }
    }, 8000)
  })
}

// ---------- 素材传输 ----------

/** 本地新增素材时向局域网广播（大文件分片 base64） */
export async function pushAssetToLan(meta: AssetMeta, blob: Blob): Promise<void> {
  if (!isLanConnected()) return
  const total = Math.max(1, Math.ceil(blob.size / CHUNK_SIZE))
  send({ t: 'asset-meta', asset: meta, totalChunks: total })
  for (let i = 0; i < total; i++) {
    const slice = blob.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const buf = new Uint8Array(await slice.arrayBuffer())
    send({
      t: 'asset-chunk',
      assetId: meta.id,
      index: i,
      total,
      data: bufToB64(buf),
    })
  }
}

/** 从局域网请求素材，成功（写入本地 db）返回 true */
export function requestAssetFromLan(assetId: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isLanConnected()) {
      resolve(false)
      return
    }
    const list = assetWaiters.get(assetId) ?? []
    list.push(() => resolve(true))
    assetWaiters.set(assetId, list)
    // 同一素材只发一次请求，避免多条传输流互相覆盖
    if (!assetRequestsInFlight.has(assetId)) {
      assetRequestsInFlight.add(assetId)
      send({ t: 'asset-request', assetId })
    }

    // 8s 超时
    setTimeout(() => {
      const pending = assetWaiters.get(assetId)
      if (pending && pending.length > 0) {
        // 只移除最早注册的这个 waiter
        pending.shift()
        if (pending.length === 0) {
          assetWaiters.delete(assetId)
          assetRequestsInFlight.delete(assetId)
        }
        resolve(false)
      }
    }, 8000)
  })
}

function receiveAssetMeta(msg: LanMessage): void {
  const asset = msg.asset as AssetMeta
  if (!asset?.id) return
  const total = Math.max(1, Number(msg.totalChunks ?? 1))
  const existing = pendingAssets.get(asset.id)
  // 已有同源传输在收集时保留已收到的分片，避免覆盖丢失
  if (existing && existing.total === total && existing.chunks.some((c) => c !== null)) {
    return
  }
  pendingAssets.set(asset.id, {
    meta: asset,
    total,
    chunks: new Array(total).fill(null),
  })
}

function receiveAssetChunk(msg: LanMessage): void {
  const assetId = String(msg.assetId ?? '')
  const index = Number(msg.index ?? 0)
  const pending = pendingAssets.get(assetId)
  if (!pending) return
  if (index < 0 || index >= pending.total) return
  // 相同分片只保留第一个（多传输流重复时以先到为准）
  // 剥掉分片自身的 base64 填充，整段拼接后统一补回，避免 atob 报非法字符
  if (pending.chunks[index] === null) {
    pending.chunks[index] = String(msg.data ?? '').replace(/=+$/, '')
  }
  if (pending.chunks.every((c) => c !== null)) {
    pendingAssets.delete(assetId)
    assetRequestsInFlight.delete(assetId)
    try {
      const binary = b64ToUint8(pending.chunks.join(''))
      const blob = new Blob([binary], { type: pending.meta.mime || 'application/octet-stream' })
      void db.assets
        .put({
          id: pending.meta.id,
          name: pending.meta.name ?? '资源',
          mime: pending.meta.mime ?? 'application/octet-stream',
          size: blob.size,
          kind: pending.meta.kind ?? 'file',
          blob,
        })
        .then(() => {
          const waiters = assetWaiters.get(assetId)
          if (waiters) {
            assetWaiters.delete(assetId)
            assetRequestsInFlight.delete(assetId)
            for (const w of waiters) w()
          }
        })
    } catch {
      // 素材落库失败，静默
    }
  }
}

async function respondAssetRequest(msg: LanMessage): Promise<void> {
  const assetId = String(msg.assetId ?? '')
  const from = String(msg.from ?? '')
  if (!assetId || !from) return
  const record = await db.assets.get(assetId)
  if (!record?.blob) return
  send({
    t: 'asset-meta',
    to: from,
    asset: {
      id: record.id,
      name: record.name,
      mime: record.mime,
      size: record.size,
      kind: record.kind,
    },
    totalChunks: Math.max(1, Math.ceil(record.blob.size / CHUNK_SIZE)),
  })
  const total = Math.max(1, Math.ceil(record.blob.size / CHUNK_SIZE))
  for (let i = 0; i < total; i++) {
    const slice = record.blob.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const buf = new Uint8Array(await slice.arrayBuffer())
    send({
      t: 'asset-chunk',
      to: from,
      assetId,
      index: i,
      total,
      data: bufToB64(buf),
    })
  }
}

// ---------- 工具 ----------

/** 字节 → 无填充 base64（分片按 3 的倍数对齐，去掉自身填充以便整段拼接） */
export function bufToB64(buf: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)))
  }
  return btoa(bin).replace(/=+$/, '')
}

/** 无填充 base64 → 字节（末尾补 '=' 到 4 的倍数再解码） */
export function b64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  // 拼接后的无填充 base64，末尾补回 '=' 到 4 的倍数再解码
  let s = b64
  while (s.length % 4 !== 0) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
