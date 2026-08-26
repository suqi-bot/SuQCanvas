import { db, type ProjectRecord } from '../db/db'
import { useCanvasStore } from '../store/canvasStore'
import { useLanStore, type LanUser, type LanActivityKind } from '../store/lanStore'
import { toast } from '../store/uiStore'
import type { AssetMeta, SuqEdge, SuqNode } from '../types'
import type { Viewport } from '@xyflow/react'
import { getLanUserColor } from './lanColors'

// 分片大小取 3 的倍数，使每个分片的 base64 都对齐到字节边界，
// 各分片无填充 base64 拼接后才能精确还原原始数据
const CHUNK_SIZE = 262143 // 256KB - 1（262143 % 3 === 0）
const LAN_STORAGE_KEY = 'sq:lan'

/**
 * 将用户输入解析为 WebSocket 地址。支持域名/IP、http(s) 地址及同源相对路径。
 * HTTPS 页面只能使用 WSS，否则浏览器会按混合内容直接拦截。
 */
export function resolveLanUrl(
  input: string,
  pageHref = typeof window !== 'undefined' ? window.location.href : undefined,
): string {
  const value = input.trim()
  if (!value) throw new Error('请输入局域网中继地址')

  const pageUrl = pageHref ? new URL(pageHref) : null
  let candidate = value
  if (value.startsWith('/')) {
    if (!pageUrl) throw new Error('相对地址需要在浏览器中使用')
    candidate = `${pageUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${pageUrl.host}${value}`
  } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    candidate = `${pageUrl?.protocol === 'https:' ? 'wss' : 'ws'}://${value}`
  }

  const url = new URL(candidate)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('中继地址必须使用 ws:// 或 wss://')
  }
  if (pageUrl?.protocol === 'https:' && url.protocol === 'ws:') {
    throw new Error('当前页面使用 HTTPS，请通过宝塔反向代理连接 wss:// 地址')
  }
  return url.toString()
}

/** 生产环境默认走同域名反代；可在构建时用 VITE_LAN_WS_URL 覆盖。 */
export function getDefaultLanUrl(): string {
  const configured = import.meta.env.VITE_LAN_WS_URL?.trim()
  if (configured) return configured
  if (typeof window === 'undefined') return 'ws://192.168.1.100:8790'
  if (window.location.protocol === 'http:') {
    // 宝塔用 IP/HTTP 直接部署时通常没有 Nginx WebSocket 反代，直接连接中继端口。
    return `ws://${window.location.hostname}:8790`
  }
  return `wss://${window.location.host}/lan-ws`
}

interface LanMessage {
  t: string
  from?: string
  [k: string]: unknown
}

let ws: WebSocket | null = null
let applyingRemote = false
let syncTimer: ReturnType<typeof setTimeout> | null = null
let vpTimer: ReturnType<typeof setTimeout> | null = null

// ---- 断线自动重连 ----
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let reconnectTarget: { url: string; name: string } | null = null
let hasConnectedBefore = false
let reconnectInProgress = false

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  reconnectTarget = null
  reconnectInProgress = false
}

function scheduleReconnect(): void {
  if (reconnectTimer || !reconnectTarget) return
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempts)
  reconnectAttempts += 1
  if (reconnectAttempts === 1) {
    useLanStore.setState({ status: 'connecting' })
    toast('局域网连接断开，正在自动重连…', 'info')
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    const target = reconnectTarget
    if (!target || isLanConnected()) return
    lanConnect(target.url, target.name, { isReconnect: true })
  }, delay)
}

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

function roomSend(t: string, payload: Record<string, unknown>): void {
  const projectId = useLanStore.getState().activeProjectId
  if (!projectId || !isLanConnected()) return
  send({ t, projectId, ...payload })
}

function parseProjectList(
  value: unknown,
): Array<{ id: string; name: string; updatedAt: number }> {
  return ((value as Array<{ id?: string; name?: string; updatedAt?: number }>) ?? [])
    .filter((project) => project?.id)
    .map((project) => ({
      id: String(project.id),
      name: String(project.name ?? '未命名项目'),
      updatedAt: Number(project.updatedAt) || 0,
    }))
}

function parseUsers(value: unknown): LanUser[] {
  return ((value as Array<Partial<LanUser>>) ?? [])
    .filter((user) => user?.id)
    .map((user) => {
      const id = String(user.id)
      return {
        id,
        name: String(user.name ?? '协作者'),
        ip: String(user.ip ?? ''),
        projectId: user.projectId ?? null,
        color: getLanUserColor(id, user.color),
      }
    })
}

export function lanConnect(url: string, name: string, opts: { isReconnect?: boolean } = {}): boolean {
  if (ws) {
    ws.onclose = null
    ws.onerror = null
    ws.close()
    ws = null
  }
  if (!opts.isReconnect) cancelReconnect()
  else reconnectInProgress = true
  const store = useLanStore.getState()

  let resolvedUrl: string
  try {
    resolvedUrl = resolveLanUrl(url)
  } catch (error) {
    store.setStatus('error')
    toast(error instanceof Error ? error.message : '局域网连接地址无效', 'error')
    return false
  }

  store.setStatus('connecting')
  store.setUrl(resolvedUrl)
  store.setName(name)

  let sock: WebSocket
  try {
    sock = new WebSocket(resolvedUrl)
  } catch {
    store.setStatus('error')
    toast('局域网连接地址无效', 'error')
    return false
  }
  ws = sock
  let opened = false

  sock.onopen = () => {
    opened = true
    reconnectInProgress = false
    hasConnectedBefore = true
    reconnectTarget = { url: resolvedUrl, name }
    reconnectAttempts = 0
    try {
      localStorage.setItem(LAN_STORAGE_KEY, JSON.stringify({ url: resolvedUrl, name }))
    } catch {
      // 忽略存储失败
    }
    useLanStore.setState({ status: 'connected', followId: null, remoteViewport: null })
    send({ t: 'hello', name })
    const activeProjectId = useLanStore.getState().activeProjectId
    if (activeProjectId) send({ t: 'join-project', projectId: activeProjectId })
    toast(opts.isReconnect ? '已恢复局域网协作连接' : '已连接局域网协作', 'success')
    // 加入后请求当前画布引用的素材
    const nodes = useCanvasStore.getState().nodes
    for (const n of nodes) {
      if (n.data?.assetId) void requestAssetFromLan(n.data.assetId)
    }
  }

  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    useLanStore.setState({
      status: opened ? 'idle' : 'error',
      users: [],
      followId: null,
      remoteViewport: null,
    })
    useLanStore.getState().clearCollaborationState()
    useLanStore.getState().clearRemoteProjects()
    if (opened) {
      if (hasConnectedBefore && reconnectTarget) {
        scheduleReconnect()
      } else {
        toast('局域网连接已断开', 'error')
      }
    } else if (reconnectInProgress && hasConnectedBefore && reconnectTarget) {
      scheduleReconnect()
    }
  }

  sock.onerror = () => {
    if (ws === sock) {
      useLanStore.setState({ status: 'error' })
      if (!opened) toast('无法连接局域网中继，请检查地址和反向代理配置', 'error')
    }
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
  return true
}

export function lanDisconnect(): void {
  cancelReconnect()
  hasConnectedBefore = false
  try {
    localStorage.removeItem(LAN_STORAGE_KEY)
  } catch {
    // 忽略
  }
  const sock = ws
  ws = null
  if (sock) {
    sock.onclose = null
    sock.onerror = null
    sock.close()
  }
  useLanStore.setState({ status: 'idle', users: [], followId: null, remoteViewport: null })
  useLanStore.getState().clearCollaborationState()
  useLanStore.getState().clearRemoteProjects()
}

/** 读取上次连接保存的地址与昵称 */
export function getSavedLanConfig(): { url: string; name: string } | null {
  try {
    const raw = localStorage.getItem(LAN_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { url?: string; name?: string }
    if (!saved?.url) return null
    return { url: saved.url, name: saved.name ?? '' }
  } catch {
    return null
  }
}

/** 刷新/加载页面后根据上次保存的地址自动重连，失败时持续自动重试 */
export function autoReconnectLan(): void {
  if (isLanConnected()) return
  const saved = getSavedLanConfig()
  if (!saved) return
  hasConnectedBefore = true
  reconnectTarget = saved
  reconnectInProgress = true
  lanConnect(saved.url, saved.name, { isReconnect: true })
}

function handleMessage(msg: LanMessage): void {
  const lan = useLanStore.getState()
  switch (msg.t) {
    case 'welcome':
      lan.setSelfId(String(msg.id ?? ''))
      lan.setUsers(parseUsers(msg.users))
      lan.setSharedProjects(parseProjectList(msg.projects))
      break
    case 'peer-joined': {
      // 同一项目有新设备加入，把当前画布定向发给它
      const targetId = String(msg.id ?? '')
      if (!targetId || targetId === lan.selfId) break
      const { nodes, edges } = useCanvasStore.getState()
      send({
        t: 'sync',
        to: targetId,
        projectId: lan.activeProjectId,
        nodes: stripSelected(nodes),
        edges,
      })
      break
    }
    case 'users':
      lan.setUsers(parseUsers(msg.users))
      break
    case 'leave': {
      const id = String(msg.id ?? '')
      lan.removeUser(id)
      lan.removeCursor(id)
      lan.clearEditing(id)
      break
    }
    case 'project-list':
      lan.setSharedProjects(parseProjectList(msg.projects))
      break
    case 'project-joined': {
      const projectId = String(msg.projectId ?? '')
      if (!projectId || msg.exists !== false || lan.activeProjectId !== projectId) break
      void db.projects.get(projectId).then((project) => {
        if (project && useLanStore.getState().activeProjectId === projectId) {
          saveProjectToLan(project)
        }
      })
      break
    }
    case 'project-data': {
      const project = msg.project as ProjectRecord | undefined
      if (!project?.id) break
      const waiters = projectDataWaiters.get(project.id)
      void (async () => {
        try {
          const local = await db.projects.get(project.id)
          await db.projects.put(project)
          if (waiters?.length) {
            projectDataWaiters.delete(project.id)
            for (const w of waiters) w(project)
          }
          if (
            lan.activeProjectId === project.id &&
            (!local || project.updatedAt >= local.updatedAt)
          ) {
            const { useProjectStore } = await import('../store/projectStore')
            if (useLanStore.getState().activeProjectId !== project.id) return
            useCanvasStore.setState({
              nodes: project.graph.nodes,
              edges: project.graph.edges,
              viewport: project.viewport,
            })
            useCanvasStore.getState().clearHistory()
            useProjectStore.setState({
              projectId: project.id,
              projectName: project.name,
              loaded: true,
              saveStatus: 'saved',
            })
          }
        } catch {
          if (waiters?.length) {
            projectDataWaiters.delete(project.id)
            for (const w of waiters) w(null)
          }
        }
      })()
      break
    }
    case 'project-deleted': {
      const projectId = String(msg.projectId ?? '')
      if (!projectId) break
      void db.projects.delete(projectId)
      if (lan.activeProjectId === projectId) {
        lan.setActiveProjectId(null)
        lan.clearCollaborationState()
        toast('当前协作项目已从局域网主机删除', 'error')
      }
      break
    }
    case 'sync': {
      if (msg.from === lan.selfId) return
      if (msg.projectId && msg.projectId !== lan.activeProjectId) return
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
    case 'cursor':
      if (msg.from === lan.selfId || msg.projectId !== lan.activeProjectId) return
      lan.setCursor({ userId: String(msg.from ?? ''), name: String(msg.name ?? '协作者'), color: getLanUserColor(String(msg.from ?? ''), msg.color), x: Number(msg.x) || 0, y: Number(msg.y) || 0, updatedAt: Number(msg.updatedAt) || Date.now() })
      break
    case 'editing':
      if (msg.from === lan.selfId || msg.projectId !== lan.activeProjectId) return
      if (msg.active === false) lan.clearEditing(String(msg.from ?? ''))
      else lan.setEditing({ userId: String(msg.from ?? ''), name: String(msg.name ?? '协作者'), color: getLanUserColor(String(msg.from ?? ''), msg.color), nodeId: String(msg.nodeId ?? ''), label: String(msg.label ?? '节点'), updatedAt: Number(msg.updatedAt) || Date.now() })
      break
    case 'activity':
      if (msg.from === lan.selfId || msg.projectId !== lan.activeProjectId) return
      lan.addActivity({ id: String(msg.id ?? `${msg.from}-${Date.now()}`), userId: String(msg.from ?? ''), name: String(msg.name ?? '协作者'), color: getLanUserColor(String(msg.from ?? ''), msg.color), kind: (msg.kind as LanActivityKind) || 'change', message: String(msg.message ?? ''), nodeId: msg.nodeId ? String(msg.nodeId) : undefined, createdAt: Number(msg.createdAt) || Date.now() })
      break
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
let previousGraph: { nodes: SuqNode[]; edges: SuqEdge[] } | null = null
let activityTimer: ReturnType<typeof setTimeout> | null = null
let pendingActivity: { kind: LanActivityKind; message: string; nodeId?: string } | null = null

function stripSelected(nodes: SuqNode[]): SuqNode[] {
  return nodes.map((n) => (n.selected ? { ...n, selected: false } : n))
}

function scheduleSyncBroadcast(): void {
  if (!isLanConnected() || applyingRemote || !useLanStore.getState().activeProjectId) return
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
      projectId: useLanStore.getState().activeProjectId,
      nodes: stripSelected(payload.nodes),
      edges: payload.edges,
    })
  }, 150)
}

function scheduleActivity(kind: LanActivityKind, message: string, nodeId?: string): void {
  if (!isLanConnected() || applyingRemote || !useLanStore.getState().activeProjectId) return
  pendingActivity = { kind, message, nodeId }
  if (activityTimer) return
  activityTimer = setTimeout(() => {
    activityTimer = null
    const item = pendingActivity
    pendingActivity = null
    if (!item) return
    const lan = useLanStore.getState()
    const activity = { id: `${lan.selfId}-${Date.now()}`, userId: lan.selfId, name: lan.name || '我', color: getLanUserColor(lan.selfId, lan.users.find((user) => user.id === lan.selfId)?.color), ...item, createdAt: Date.now() }
    lan.addActivity(activity)
    roomSend('activity', activity)
  }, 350)
}

function scheduleViewportBroadcast(): void {
  if (!isLanConnected() || applyingRemote || !useLanStore.getState().activeProjectId) return
  const lan = useLanStore.getState()
  if (lan.followId) return // 跟随他人时不广播自己的视口
  if (vpTimer) return
  vpTimer = setTimeout(() => {
    vpTimer = null
    if (!isLanConnected()) return
    if (useLanStore.getState().followId) return
    send({
      t: 'viewport',
      projectId: useLanStore.getState().activeProjectId,
      viewport: useCanvasStore.getState().viewport,
    })
  }, 100)
}

export function initLanSync(): () => void {
  const unsub = useCanvasStore.subscribe((state, prev) => {
    if (state.nodes !== prev.nodes || state.edges !== prev.edges) {
      scheduleSyncBroadcast()
      if (!previousGraph) previousGraph = { nodes: prev.nodes, edges: prev.edges }
      const nodesChanged = state.nodes.length !== prev.nodes.length
      const edgesChanged = state.edges.length !== prev.edges.length
      if (nodesChanged) scheduleActivity(state.nodes.length > prev.nodes.length ? 'create' : 'delete', state.nodes.length > prev.nodes.length ? '新增节点' : '删除节点')
      else if (edgesChanged) scheduleActivity('connect', '更新连线')
      else {
        const moved = state.nodes.some((n) => { const p = prev.nodes.find((x) => x.id === n.id); return p && (p.position.x !== n.position.x || p.position.y !== n.position.y) })
        const edited = state.nodes.some((n) => { const p = prev.nodes.find((x) => x.id === n.id); return p && JSON.stringify(p.data) !== JSON.stringify(n.data) })
        if (moved) scheduleActivity('move', '移动节点')
        else if (edited) scheduleActivity('edit', '编辑节点')
        else scheduleActivity('change', '更新画布')
      }
      previousGraph = { nodes: state.nodes, edges: state.edges }
    }
    if (state.viewport !== prev.viewport) {
      scheduleViewportBroadcast()
    }
  })
  return unsub
}

// ---------- 项目同步 ----------

/** 刷新由局域网主机持久保存的共享项目列表。 */
export async function broadcastLocalProjects(): Promise<void> {
  if (!isLanConnected()) return
  send({ t: 'project-list-request' })
}

/** 加入一个项目房间；实时画布、视口和素材只在该项目内传输。 */
export function joinLanProject(projectId: string): void {
  const lan = useLanStore.getState()
  if (lan.activeProjectId === projectId) return
  lan.setActiveProjectId(projectId)
  lan.clearCollaborationState()
  lan.setFollowId(null)
  lan.clearRemoteViewport()
  if (isLanConnected()) send({ t: 'join-project', projectId })
}

export function leaveLanProject(): void {
  const lan = useLanStore.getState()
  lan.setActiveProjectId(null)
  lan.setFollowId(null)
  lan.clearRemoteViewport()
  lan.clearCollaborationState()
  if (isLanConnected()) send({ t: 'leave-project' })
}

export function sendLanCursor(x: number, y: number): void {
  const lan = useLanStore.getState()
  roomSend('cursor', { x, y, name: lan.name, updatedAt: Date.now() })
}

export function setLanEditing(nodeId: string, label: string): void {
  const lan = useLanStore.getState()
  roomSend('editing', { nodeId, label, name: lan.name, active: true, updatedAt: Date.now() })
}

export function clearLanEditing(): void {
  roomSend('editing', { active: false, name: useLanStore.getState().name, updatedAt: Date.now() })
}

export function isNodeLockedByOther(nodeId: string): boolean {
  const selfId = useLanStore.getState().selfId
  return Object.values(useLanStore.getState().editing).some(
    (item) => item.nodeId === nodeId && item.userId !== selfId,
  )
}

/** 将项目快照保存到运行中继服务的局域网主机。 */
export function saveProjectToLan(project: ProjectRecord): boolean {
  if (!isLanConnected()) return false
  send({ t: 'project-save', project })
  return true
}

export function deleteProjectFromLan(projectId: string): boolean {
  if (!isLanConnected()) return false
  send({ t: 'project-delete', projectId })
  if (useLanStore.getState().activeProjectId === projectId) leaveLanProject()
  return true
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
