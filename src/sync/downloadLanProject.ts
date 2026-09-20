import { db, type AssetRecord, type ProjectRecord } from '../db/db'
import { useLanStore } from '../store/lanStore'
import { genUuid } from '../utils/uuid'
import { b64ToUint8, isLanConnected } from './lanClient'

interface Message { t: string; [key: string]: unknown }

/** Download an independent local copy; never join or replace the active collaboration canvas. */
export async function downloadLanProject(
  projectId: string,
  onProgress: (message: string) => void = () => {},
): Promise<ProjectRecord> {
  if (!isLanConnected()) throw new Error('请先连接服务器')
  const socket = new WebSocket(useLanStore.getState().url)
  const request = <T>(send: object, read: (message: Message) => T | undefined): Promise<T> =>
    new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const clean = () => {
        clearTimeout(timer)
        socket.removeEventListener('message', message)
        socket.removeEventListener('close', failed)
        socket.removeEventListener('error', failed)
      }
      const fail = (error: Error) => { clean(); reject(error) }
      const failed = () => fail(new Error('下载连接中断，请重试'))
      const resetTimer = () => {
        clearTimeout(timer)
        timer = setTimeout(() => fail(new Error('下载超时，项目或素材可能已不存在')), 60000)
      }
      const message = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(String(event.data)) as Message
          const value = read(msg)
          if (value !== undefined) { clean(); resolve(value) }
          else if (msg.t === 'asset-chunk') resetTimer()
        } catch (error) { fail(error instanceof Error ? error : new Error('无效的服务器数据')) }
      }
      socket.addEventListener('message', message)
      socket.addEventListener('close', failed)
      socket.addEventListener('error', failed)
      resetTimer()
      if (socket.readyState !== WebSocket.OPEN) { failed(); return }
      socket.send(JSON.stringify(send))
    })

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接服务器超时')), 10000)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接服务器')) }, { once: true })
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('下载连接中断')) }, { once: true })
    })
    onProgress('读取服务器项目…')
    const remote = await request<ProjectRecord>({ t: 'join-project', projectId }, (msg) => {
      if (msg.t === 'project-joined' && msg.exists === false) throw new Error('服务器项目已不存在')
      if (msg.t !== 'project-data' || msg.from !== 'server') return
      const project = msg.project as ProjectRecord
      if (project?.id !== projectId || !Array.isArray(project.graph?.nodes) || !Array.isArray(project.graph?.edges)) {
        throw new Error('服务器项目数据无效')
      }
      return project
    })
    const assetIds = [...new Set(remote.graph.nodes.flatMap((node) =>
      [node.data?.assetId, node.data?.coverAssetId].filter((id): id is string => !!id),
    ))]
    const assetMap = new Map<string, string>()
    const assets: AssetRecord[] = []
    for (const [i, assetId] of assetIds.entries()) {
      onProgress(`下载素材 ${i + 1}/${assetIds.length}`)
      let meta: Omit<AssetRecord, 'blob'> | undefined
      let thumbnail: Blob | undefined
      let total = 0
      const parts = new Map<number, Uint8Array<ArrayBuffer>>()
      const asset = await request<AssetRecord>({ t: 'asset-request', assetId, forceBlob: true }, (msg) => {
        if (msg.from !== 'server') return
        if (msg.t === 'asset-thumb' && msg.assetId === assetId) {
          thumbnail = new Blob([b64ToUint8(String(msg.data))], { type: 'image/jpeg' })
        }
        if (msg.t === 'asset-meta' && (msg.asset as AssetRecord)?.id === assetId) {
          meta = msg.asset as AssetRecord
          total = Number(msg.totalChunks)
          if (!Number.isInteger(total) || total < 1 || total > 8192 || !Number.isFinite(meta.size) || meta.size < 0) {
            throw new Error('服务器素材数据无效')
          }
        }
        if (msg.t !== 'asset-chunk' || msg.assetId !== assetId || !meta) return
        const index = Number(msg.index)
        if (!Number.isInteger(index) || index < 0 || index >= total) throw new Error('素材分片无效')
        parts.set(index, b64ToUint8(String(msg.data)))
        if (parts.size !== total) return
        const blob = new Blob(Array.from({ length: total }, (_, part) => parts.get(part)!), { type: meta.mime })
        if (blob.size !== meta.size) throw new Error('下载的素材不完整，请重试')
        return { id: genUuid(), name: meta.name, mime: meta.mime, kind: meta.kind, size: meta.size, blob, thumbnail }
      })
      assetMap.set(assetId, asset.id)
      assets.push(asset)
    }
    const now = Date.now()
    const project: ProjectRecord = {
      id: genUuid(), name: `${remote.name}（本地副本）`, createdAt: now, updatedAt: now,
      viewport: remote.viewport,
      graph: { edges: remote.graph.edges, nodes: remote.graph.nodes.map((node) => ({
        ...node, data: { ...node.data,
          ...(node.data.assetId ? { assetId: assetMap.get(node.data.assetId)! } : {}),
          ...(node.data.coverAssetId ? { coverAssetId: assetMap.get(node.data.coverAssetId)! } : {}),
        },
      })) },
    }
    onProgress('保存本地副本…')
    await db.transaction('rw', db.projects, db.assets, async () => {
      await db.assets.bulkAdd(assets)
      await db.projects.add(project)
    })
    return project
  } finally { socket.close() }
}
