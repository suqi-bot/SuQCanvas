import { db, type ProjectRecord } from '../db/db'
import { getDeviceId } from '../utils/deviceId'
import { bufToB64, isLanConnected } from './lanClient'
import { useLanStore } from '../store/lanStore'

const CHUNK_SIZE = 262143

/** Use a separate connection so uploading another project never switches the active canvas. */
export async function syncLocalProjectToLan(
  project: ProjectRecord,
  onProgress: (message: string) => void = () => {},
): Promise<void> {
  if (!isLanConnected()) throw new Error('请先连接局域网服务器')
  const ids = [...new Set(project.graph.nodes.flatMap((node) =>
    [node.data?.assetId, node.data?.coverAssetId].filter((id): id is string => !!id),
  ))]
  const assets = await db.assets.bulkGet(ids)
  for (let i = 0; i < ids.length; i++) {
    const asset = assets[i]
    if (!asset?.blob || asset.blob.size !== asset.size) {
      throw new Error(`本地素材不完整：${asset?.name ?? ids[i]}，请先恢复素材再同步`)
    }
    if (Math.ceil(asset.blob.size / CHUNK_SIZE) > 8192) {
      throw new Error(`素材过大，暂不支持同步：${asset.name}`)
    }
  }

  const { url, name } = useLanStore.getState()
  const socket = new WebSocket(url)
  const waiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  let sequence = 0
  const fail = () => {
    for (const waiter of waiters.values()) waiter.reject(new Error('服务器连接已断开，请重试'))
    waiters.clear()
  }
  socket.addEventListener('close', fail)
  socket.addEventListener('error', fail)
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.t !== 'local-sync-result') return
    const waiter = waiters.get(msg.requestId)
    if (msg.error) waiter?.reject(new Error(String(msg.error)))
    else waiter?.resolve()
  })
  const send = (message: object) => {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('服务器连接已断开，请重试')
    socket.send(JSON.stringify(message))
  }
  const request = (message: object): Promise<void> => {
    const requestId = String(++sequence)
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('同步超时，请确认服务器已更新并重试')), 60000)
      waiters.set(requestId, {
        resolve: () => { clearTimeout(timer); resolve() },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      try { send({ ...message, requestId }) } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    }).finally(() => { waiters.delete(requestId) })
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接服务器超时')), 10000)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接服务器')) }, { once: true })
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('服务器连接已断开')) }, { once: true })
    })
    send({ t: 'hello', name, deviceId: getDeviceId() })
    await request({ t: 'local-sync-start', projectId: project.id })
    for (const [i, asset] of assets.entries()) {
      if (!asset) continue
      const { id, name: assetName, mime, size, kind, blob, thumbnail } = asset
      onProgress(`上传素材 ${i + 1}/${assets.length}：${assetName}`)
      if (thumbnail && thumbnail.size <= 2_000_000) {
        send({ t: 'asset-thumb', assetId: id, data: bufToB64(new Uint8Array(await thumbnail.arrayBuffer())), to: 'server' })
      }
      const total = Math.max(1, Math.ceil(blob.size / CHUNK_SIZE))
      send({ t: 'asset-meta', asset: { id, name: assetName, mime, size, kind }, totalChunks: total, to: 'server' })
      for (let index = 0; index < total; index++) {
        // Keep large uploads bounded instead of queueing the whole file in browser memory.
        const deadline = Date.now() + 60000
        while (socket.bufferedAmount > 2 * 1024 * 1024) {
          if (socket.readyState !== WebSocket.OPEN || Date.now() > deadline) throw new Error('素材上传中断，请重试')
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        const bytes = new Uint8Array(await blob.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE).arrayBuffer())
        send({ t: 'asset-chunk', assetId: id, index, total, data: bufToB64(bytes), to: 'server' })
      }
    }
    onProgress('等待服务器保存…')
    await request({ t: 'local-sync-commit', project })
  } finally {
    socket.close()
  }
}
