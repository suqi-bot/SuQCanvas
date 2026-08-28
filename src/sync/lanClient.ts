import { db, type AssetRecord, type ProjectRecord } from '../db/db'
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

// ---- 显式删除传播（并集合并的配套机制） ----
// 接收端改为按 id 并集合并后，快照不再表达「删除」，被删除的节点/连线
// 单独以 sync-del 消息广播；删除后 TOMBSTONE_MS 内该 id 记为墓碑，
// 晚到的旧快照即使包含它也不会被复活（id 由 genId 生成、不重复，
// 窗口期内「删除优先」不会误伤真正的重建）。
const TOMBSTONE_MS = 60_000
const tombstones = new Map<string, number>()

function isTombstoned(id: string): boolean {
  const expiry = tombstones.get(id)
  if (expiry === undefined) return false
  if (Date.now() > expiry) {
    tombstones.delete(id)
    return false
  }
  return true
}

function stampTombstone(id: string): void {
  tombstones.set(id, Date.now() + TOMBSTONE_MS)
}

function clearTombstones(): void {
  tombstones.clear()
}

// 批量删除调度：一次删除动作（如删除选区）合并成一条消息快速发出
let delTimer: ReturnType<typeof setTimeout> | null = null
const pendingDeletes: { nodeIds: string[]; edgeIds: string[] } = { nodeIds: [], edgeIds: [] }

function scheduleSyncDel(nodeIds: string[], edgeIds: string[]): void {
  if (!isLanConnected() || applyingRemote || !useLanStore.getState().activeProjectId) return
  // 本端也立墓碑：防止自己在删除后收到含该 id 的晚到旧快照而复活
  for (const id of nodeIds) stampTombstone(id)
  for (const id of edgeIds) stampTombstone(id)
  pendingDeletes.nodeIds.push(...nodeIds)
  pendingDeletes.edgeIds.push(...edgeIds)
  if (delTimer) return
  delTimer = setTimeout(() => {
    delTimer = null
    const nodeIds = pendingDeletes.nodeIds
    const edgeIds = pendingDeletes.edgeIds
    pendingDeletes.nodeIds = []
    pendingDeletes.edgeIds = []
    if ((nodeIds.length === 0 && edgeIds.length === 0) || !isLanConnected()) return
    roomSend('sync-del', { nodeIds, edgeIds })
  }, 80)
}

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

/** 素材传输空闲超时：持续收到分片就续期，长时间无数据才判定失败（大视频不再被固定 8s 误杀） */
const ASSET_IDLE_TIMEOUT_MS = 60_000

/** assetId -> 分片收集（直接存解码后的字节分片，避免拼接整个 base64 造成双倍内存） */
interface PendingAsset {
  meta: AssetMeta
  total: number
  parts: (Uint8Array | null)[]
}
const pendingAssets = new Map<string, PendingAsset>()
const assetWaiters = new Map<string, Array<(ok: boolean) => void>>()
const assetRequestsInFlight = new Set<string>()
/** assetId -> 空闲超时定时器 */
const assetIdleTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** `${assetId}:${from}` -> 发送中，防止同一接收方被重复响应产生多条传输流 */
const sendingTargets = new Set<string>()
/** assetId -> 服务器可提供的 HTTP 流式拉流地址（仅视频），命中后播放器直接用，不再整份下载 */
const httpAssetUrls = new Map<string, string>()

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
    clearAllAssetTransfers()
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
    if (activeProjectId) {
      send({ t: 'join-project', projectId: activeProjectId })
      // 重连对账:离线期间可能错过了 sync-del 删除,本地会残留已删除的节点。
      // 拉取中继保存的项目快照,project-data 处理按 updatedAt 比较:
      // 仅当远端更新时整幅替换(删除收敛),本地有更新的离线编辑不被覆盖。
      void fetchProjectFromLan(activeProjectId)
    }
    toast(opts.isReconnect ? '已恢复局域网协作连接' : '已连接局域网协作', 'success')
    // 加入后请求当前画布引用的素材 + 重连续传未完成的素材（接收端跳过已收分片）
    const nodeAssetIds = new Set<string>()
    for (const n of useCanvasStore.getState().nodes) {
      if (n.data?.assetId) nodeAssetIds.add(n.data.assetId)
    }
    for (const assetId of pendingAssets.keys()) nodeAssetIds.add(assetId)
    for (const assetId of nodeAssetIds) void requestAssetFromLan(assetId)
  }

  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    // 保留已收分片，自动重连后可从断点续传
    interruptAssetTransfers()
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
  clearAllAssetTransfers()
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
      const remoteNodes = (msg.nodes as SuqNode[]) ?? []
      const remoteEdges = (msg.edges as SuqEdge[]) ?? []
      applyingRemote = true
      try {
        // 按 id 并集合并：远端节点覆盖同名字段，本地独有节点保留。
        // 多人并发导入时各自的新节点不再被对方早到的快照整幅"抹掉"；
        // 删除由 sync-del 显式传播，普通快照不再隐式删除。
        const sel = new Set(useCanvasStore.getState().nodes.filter((n) => n.selected).map((n) => n.id))
        const remoteById = new Map<string, SuqNode>()
        for (const n of remoteNodes) {
          if (!isTombstoned(n.id)) remoteById.set(n.id, n)
        }
        const mergedNodes: SuqNode[] = []
        for (const n of useCanvasStore.getState().nodes) {
          const r = remoteById.get(n.id)
          if (r) remoteById.delete(n.id)
          const pick = r ?? n
          mergedNodes.push(sel.has(pick.id) ? { ...pick, selected: true } : pick)
        }
        for (const r of remoteById.values()) {
          mergedNodes.push(sel.has(r.id) ? { ...r, selected: true } : r)
        }
        const remoteEdgeById = new Map(remoteEdges.map((e) => [e.id, e]))
        const mergedEdges: SuqEdge[] = []
        for (const e of useCanvasStore.getState().edges) {
          if (isTombstoned(e.id)) continue
          const r = remoteEdgeById.get(e.id)
          if (r) remoteEdgeById.delete(e.id)
          mergedEdges.push(r ?? e)
        }
        for (const r of remoteEdgeById.values()) {
          if (!isTombstoned(r.id)) mergedEdges.push(r)
        }
        useCanvasStore.setState({ nodes: mergedNodes, edges: mergedEdges })
      } finally {
        applyingRemote = false
      }
      // 远端节点引用的素材若本地缺失，向局域网拉取
      for (const n of remoteNodes) {
        const assetId = n.data?.assetId
        if (!assetId) continue
        if (assetWaiters.has(assetId) || pendingAssets.has(assetId)) continue
        void db.assets.get(assetId).then((rec) => {
          if (!rec && assetWaiters.has(assetId) === false) void requestAssetFromLan(assetId)
        })
      }
      break
    }
    case 'sync-del': {
      if (msg.from === lan.selfId) return
      if (msg.projectId && msg.projectId !== lan.activeProjectId) return
      const nodeIds = (msg.nodeIds as string[] | undefined) ?? []
      const edgeIds = (msg.edgeIds as string[] | undefined) ?? []
      if (nodeIds.length === 0 && edgeIds.length === 0) break
      for (const id of nodeIds) stampTombstone(id)
      for (const id of edgeIds) stampTombstone(id)
      const removeN = new Set(nodeIds)
      const removeE = new Set(edgeIds)
      applyingRemote = true
      try {
        useCanvasStore.setState((state) => ({
          nodes: state.nodes.filter((n) => !removeN.has(n.id)),
          edges: state.edges.filter((e) => !removeE.has(e.id)),
        }))
      } finally {
        applyingRemote = false
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
    case 'asset-http': {
      // 服务器告知视频可走 HTTP Range 流式拉取：记录地址并停止 WebSocket 下载流
      const assetId = String(msg.assetId ?? '')
      const url = resolveHttpUrl(String(msg.url ?? ''))
      if (assetId && url) {
        httpAssetUrls.set(assetId, url)
        failAssetTransfer(assetId)
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
let previousGraph: { nodes: SuqNode[]; edges: SuqEdge[] } | null = null
let activityTimer: ReturnType<typeof setTimeout> | null = null
let pendingActivity: { kind: LanActivityKind; message: string; nodeId?: string; count?: number } | null = null

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
  // 批量操作(如连续导入的逐个新增)在防抖窗口内合并为一条通知,避免刷屏
  if (
    pendingActivity &&
    (kind === 'create' || kind === 'delete') &&
    pendingActivity.kind === kind
  ) {
    pendingActivity.count = (pendingActivity.count ?? 1) + 1
    pendingActivity.message =
      kind === 'create' ? `新增 ${pendingActivity.count} 个节点` : `删除 ${pendingActivity.count} 个节点`
    return
  }
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
      // 显式删除传播：被移除的节点/连线立即广播 sync-del
      // （并集合并后快照不再隐式表达删除，否则对方会永远保留）
      const removedNodeIds = prev.nodes
        .filter((n) => !state.nodes.some((x) => x.id === n.id))
        .map((n) => n.id)
      const removedEdgeIds = prev.edges
        .filter((e) => !state.edges.some((x) => x.id === e.id))
        .map((e) => e.id)
      if (removedNodeIds.length > 0 || removedEdgeIds.length > 0) {
        scheduleSyncDel(removedNodeIds, removedEdgeIds)
      }
      // 本地复活（撤销删除）的 id 解除墓碑，重新参与同步
      for (const n of state.nodes) {
        if (!prev.nodes.some((x) => x.id === n.id)) tombstones.delete(n.id)
      }
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
  clearTombstones()
  if (isLanConnected()) send({ t: 'join-project', projectId })
}

export function leaveLanProject(): void {
  const lan = useLanStore.getState()
  lan.setActiveProjectId(null)
  lan.setFollowId(null)
  lan.clearRemoteViewport()
  lan.clearCollaborationState()
  clearTombstones()
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

function clearAssetIdleTimeout(assetId: string): void {
  const timer = assetIdleTimers.get(assetId)
  if (timer) clearTimeout(timer)
  assetIdleTimers.delete(assetId)
}

/** 启动/续期空闲超时：只要持续有分片到达，传输就永远不被判定失败 */
function scheduleAssetIdleTimeout(assetId: string): void {
  clearAssetIdleTimeout(assetId)
  assetIdleTimers.set(
    assetId,
    setTimeout(() => failAssetTransfer(assetId), ASSET_IDLE_TIMEOUT_MS),
  )
}

/** 判定一次素材传输失败：清理进行中的传输并唤醒所有等待者（返回 false） */
function failAssetTransfer(assetId: string): void {
  clearAssetIdleTimeout(assetId)
  pendingAssets.delete(assetId)
  assetRequestsInFlight.delete(assetId)
  const waiters = assetWaiters.get(assetId)
  if (waiters) {
    assetWaiters.delete(assetId)
    for (const w of waiters) w(false)
  }
}

/** 断开/退出时清空全部素材传输状态 */
function clearAllAssetTransfers(): void {
  for (const timer of assetIdleTimers.values()) clearTimeout(timer)
  assetIdleTimers.clear()
  for (const waiters of assetWaiters.values()) {
    for (const w of waiters) w(false)
  }
  assetWaiters.clear()
  pendingAssets.clear()
  assetRequestsInFlight.clear()
  sendingTargets.clear()
  httpAssetUrls.clear()
}

/**
 * 连接断开：唤醒等待者告知传输中断，但保留已收分片与空闲超时。
 * 空闲超时到点仍未恢复会自动清理；若在超时前自动重连，
 * onopen 会重新发起请求，接收端跳过已收分片从断点续传。
 */
function interruptAssetTransfers(): void {
  for (const waiters of assetWaiters.values()) {
    for (const w of waiters) w(false)
  }
  assetWaiters.clear()
  assetRequestsInFlight.clear()
  sendingTargets.clear()
  httpAssetUrls.clear()
}

/** 把服务器返回的相对拉流地址拼上当前连接所在 origin（支持直连端口与反代） */
function resolveHttpUrl(relative: string): string | undefined {
  const wsUrl = useLanStore.getState().url
  if (!wsUrl) return undefined
  try {
    const parsed = new URL(wsUrl)
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    const base = parsed.toString().replace(/\/$/, '')
    return new URL(relative, `${base}/`).toString()
  } catch {
    return undefined
  }
}

/** 视频素材若服务器可提供 HTTP 流式拉流，返回对应地址（否则 undefined） */
export function getLanAssetHttpUrl(assetId: string): string | undefined {
  return httpAssetUrls.get(assetId)
}

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
    // 每 8 块让出一次主线程，避免大视频长时间阻塞浏览器
    if ((i & 7) === 7) await new Promise((r) => setTimeout(r, 0))
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
    list.push((ok) => resolve(ok))
    assetWaiters.set(assetId, list)
    // 同一素材只发一次请求，避免多条传输流互相覆盖。
    // 超时改为“空闲超时”：只要分片持续到达就续期，长时间无数据（源端不在线/传输中断）才判定失败。
    if (!assetRequestsInFlight.has(assetId)) {
      assetRequestsInFlight.add(assetId)
      scheduleAssetIdleTimeout(assetId)
      send({ t: 'asset-request', assetId })
    }
  })
}

function receiveAssetMeta(msg: LanMessage): void {
  const asset = msg.asset as AssetMeta
  if (!asset?.id) return
  // 该资产已可走 HTTP 流式拉流（视频），不再收集 WebSocket 分片；
  // 但仍落一条元数据记录（不含 blob），供封面生成识别视频类型
  if (httpAssetUrls.has(asset.id)) {
    void db.assets.get(asset.id).then((rec) => {
      const hasBlob = !!rec?.blob && rec.blob.size > 0
      if (hasBlob || rec?.thumbnail) return
      void db.assets
        .put({
          id: asset.id,
          name: asset.name ?? '资源',
          mime: asset.mime ?? 'video/mp4',
          size: asset.size ?? 0,
          kind: asset.kind ?? 'video',
        } as AssetRecord)
        .catch(() => {
          // 落库失败不影响流式拉流
        })
    })
    return
  }
  const total = Math.max(1, Number(msg.totalChunks ?? 1))
  const existing = pendingAssets.get(asset.id)
  // 已有同源传输在收集时保留已收到的分片，避免覆盖丢失
  if (existing && existing.total === total && existing.parts.some((p) => p !== null)) {
    scheduleAssetIdleTimeout(asset.id)
    return
  }
  pendingAssets.set(asset.id, {
    meta: asset,
    total,
    parts: new Array(total).fill(null),
  })
  scheduleAssetIdleTimeout(asset.id)
}

function receiveAssetChunk(msg: LanMessage): void {
  const assetId = String(msg.assetId ?? '')
  const index = Number(msg.index ?? 0)
  const pending = pendingAssets.get(assetId)
  if (!pending) return
  if (index < 0 || index >= pending.total) return
  // 有分片持续到达即续期空闲超时
  scheduleAssetIdleTimeout(assetId)
  // 相同分片只保留第一个（多传输流重复时以先到为准）；解码成独立字节分片，
  // 收齐后由 Blob 惰性引用，不再先拼整个 base64 再 atob（大文件内存可减半）
  if (pending.parts[index] === null) {
    try {
      pending.parts[index] = b64ToUint8(String(msg.data ?? '').replace(/=+$/, ''))
    } catch {
      // 非法分片数据，静默忽略
    }
  }
  if (pending.parts.every((p) => p !== null)) {
    pendingAssets.delete(assetId)
    assetRequestsInFlight.delete(assetId)
    clearAssetIdleTimeout(assetId)
    try {
      const blob = new Blob(pending.parts as BlobPart[], {
        type: pending.meta.mime || 'application/octet-stream',
      })
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
            for (const w of waiters) w(true)
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
  // 同一接收方同素材只响应一次，避免接收端超时重试导致多路并发传输流互相覆盖
  const key = `${assetId}:${from}`
  if (sendingTargets.has(key)) return
  sendingTargets.add(key)
  try {
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
      // 每 8 块让出一次主线程，避免大视频长时间阻塞浏览器被判定无响应
      if ((i & 7) === 7) await new Promise((r) => setTimeout(r, 0))
    }
  } catch {
    // 连接可能已断开，忽略（finally 会释放发送标记）
  } finally {
    sendingTargets.delete(key)
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
