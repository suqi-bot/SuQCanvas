import 'fake-indexeddb/auto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getThumbnailUrl } from '../media/blobRegistry'
import { db } from '../db/db'
import { useCanvasStore } from '../store/canvasStore'
import { useLanStore } from '../store/lanStore'
import type { SuqNode } from '../types'
import {
  getDefaultLanUrl,
  getLanAssetHttpUrl,
  getLanAssetThumbnail,
  joinLanProject,
  lanConnect,
  lanDisconnect,
  pushAssetToLan,
  pushThumbnailToServer,
  requestAssetFromLan,
  bufToB64,
  b64ToUint8,
  resolveLanUrl,
} from './lanClient'

// ws 的 WebSocket 与 DOM 类型不同，运行时行为兼容
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket

const PORT = 9890
const CHUNK = 262143
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

async function connectWhenReady(url: string, timeoutMs = 5000): Promise<WebSocket> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const socket = new WebSocket(url)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      return socket
    } catch {
      socket.close()
      await sleep(100)
    }
  }
  throw new Error(`LAN test server did not become ready within ${timeoutMs}ms`)
}

let server: ChildProcess
let A: WebSocket
let dataDir: string

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'suqcanvas-lan-test-'))
  server = spawn('node', ['server/lan-server.mjs'], {
    env: { ...process.env, PORT: String(PORT), LAN_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`))
  A = await connectWhenReady(`ws://127.0.0.1:${PORT}/lan-ws`)
  A.send(JSON.stringify({ t: 'hello', name: 'device-A' }))
  A.send(JSON.stringify({ t: 'join-project', projectId: 'test-project' }))
  lanConnect(`ws://127.0.0.1:${PORT}/lan-ws`, 'device-B')
  joinLanProject('test-project')
  await sleep(800)
}, 15000)

afterAll(async () => {
  try {
    A?.close()
  } catch {
    // ignore
  }
  server?.kill()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

// 模拟真实发送方：按 CHUNK 分片 → bufToB64（无填充）
function encodeChunks(bytes: Uint8Array): string[] {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(bufToB64(bytes.subarray(i, i + CHUNK)))
  }
  return parts
}

// 模拟真实接收方：拼接无填充分片 → b64ToUint8
function decodeChunks(parts: string[]): Uint8Array {
  return b64ToUint8(parts.join(''))
}

describe('base64 分片往返', () => {
  it('跨多分片（含尾部不满分片）字节完全一致', () => {
    const len = CHUNK * 2 + 5
    const src = new Uint8Array(len)
    for (let i = 0; i < len; i++) src[i] = (i * 31 + 7) % 256
    const decoded = decodeChunks(encodeChunks(src))
    expect(decoded.length).toBe(len)
    expect(Array.from(decoded)).toEqual(Array.from(src))
  })

  it('小于一个分片也能还原', () => {
    const src = new Uint8Array([0x58, 0x58, 0x59, 0x59])
    const decoded = decodeChunks(encodeChunks(src))
    expect(Array.from(decoded)).toEqual(Array.from(src))
  })
})

describe('LAN 地址解析', () => {
  it('HTTP IP 部署默认连接同服务器的中继端口', () => {
    expect(getDefaultLanUrl()).toBe('ws://192.168.1.100:8790')
  })

  it('HTTPS 页面上的相对地址解析为同源 WSS', () => {
    expect(resolveLanUrl('/lan-ws', 'https://canvas.example.com/SuQCanvas/')).toBe(
      'wss://canvas.example.com/lan-ws',
    )
  })

  it('支持省略协议并阻止 HTTPS 页面连接明文 WS', () => {
    expect(resolveLanUrl('192.168.1.8:8790', 'http://192.168.1.8/SuQCanvas/')).toBe(
      'ws://192.168.1.8:8790/',
    )
    expect(() => resolveLanUrl('ws://192.168.1.8:8790', 'https://canvas.example.com/')).toThrow(
      '当前页面使用 HTTPS',
    )
  })
})

describe('LAN 素材接收', () => {
  it('接收方自动落库广播推送的素材（内容一致）', async () => {
    const src = new Uint8Array([0x58, 0x58, 0x59, 0x59]) // "XXYY"
    const parts = encodeChunks(src)
    const assetX = { id: 'asset-X', name: 'x.bin', mime: 'application/octet-stream', size: src.length, kind: 'file' }
    A.send(JSON.stringify({ t: 'asset-meta', asset: assetX, totalChunks: parts.length }))
    parts.forEach((p, i) =>
      A.send(JSON.stringify({ t: 'asset-chunk', assetId: 'asset-X', index: i, total: parts.length, data: p })),
    )
    await sleep(1000)
    const rec = await db.assets.get('asset-X')
    expect(rec?.id).toBe('asset-X')
    const got = new Uint8Array(await rec!.blob.arrayBuffer())
    expect(Array.from(got)).toEqual(Array.from(src))
  }, 15000)

  it('分片续传：meta 重发后保留已收分片，补齐剩余分片后完整落库', async () => {
    const src = new Uint8Array(CHUNK * 2 + 9) // 3 个分片
    for (let i = 0; i < src.length; i++) src[i] = (i * 13 + 3) % 256
    const parts = encodeChunks(src)
    const assetR = {
      id: 'asset-resume',
      name: 'r.bin',
      mime: 'application/octet-stream',
      size: src.length,
      kind: 'file',
    }
    // 第一段：meta + 仅第 0 块（模拟断线前已收部分分片）
    A.send(JSON.stringify({ t: 'asset-meta', asset: assetR, totalChunks: parts.length }))
    A.send(
      JSON.stringify({ t: 'asset-chunk', assetId: 'asset-resume', index: 0, total: parts.length, data: parts[0] }),
    )
    await sleep(200)
    // 续传模拟：meta 重发（应保留已收分片）+ 补齐剩余分片
    A.send(JSON.stringify({ t: 'asset-meta', asset: assetR, totalChunks: parts.length }))
    parts.forEach((p, i) => {
      if (i === 0) return
      A.send(
        JSON.stringify({ t: 'asset-chunk', assetId: 'asset-resume', index: i, total: parts.length, data: p }),
      )
    })
    await sleep(1000)
    const rec = await db.assets.get('asset-resume')
    expect(rec?.id).toBe('asset-resume')
    const got = new Uint8Array(await rec!.blob.arrayBuffer())
    expect(Array.from(got)).toEqual(Array.from(src))
  }, 15000)

  it('请求-响应链路能取回素材（内容一致）', async () => {
    A.on('message', (data, isBinary) => {
      if (isBinary) return
      const msg = JSON.parse(data.toString())
      if (msg.t === 'asset-request') {
        const src = new Uint8Array([0x59, 0x59, 0x58, 0x58]) // "YYXX"
        const parts = encodeChunks(src)
        const assetY = { id: 'asset-Y', name: 'y.bin', mime: 'application/octet-stream', size: src.length, kind: 'file' }
        A.send(JSON.stringify({ t: 'asset-meta', to: msg.from, asset: assetY, totalChunks: parts.length }))
        parts.forEach((p, i) =>
          A.send(JSON.stringify({ t: 'asset-chunk', to: msg.from, assetId: 'asset-Y', index: i, total: parts.length, data: p })),
        )
      }
    })
    const ok = await requestAssetFromLan('asset-Y')
    const rec = await db.assets.get('asset-Y')
    expect(ok).toBe(true)
    const got = new Uint8Array(await rec!.blob.arrayBuffer())
    expect(Array.from(got)).toEqual([0x59, 0x59, 0x58, 0x58])
  }, 15000)
})

describe('LAN 资产 HTTP 流式拉流', () => {
  it('服务器缓存视频后可通过 HTTP Range 流式获取，客户端收到 asset-http 通知', async () => {
    const len = CHUNK + 100 // 2 个分片，确保文件足够大
    const src = new Uint8Array(len)
    for (let i = 0; i < len; i++) src[i] = (i * 7 + 1) % 256
    const parts = encodeChunks(src)
    const assetV = {
      id: 'asset-http-test',
      name: 'v.mp4',
      mime: 'video/mp4',
      size: src.length,
      kind: 'video',
    }
    // 通过 A 把视频推送到服务器缓存
    A.send(JSON.stringify({ t: 'asset-meta', asset: assetV, totalChunks: parts.length }))
    parts.forEach((p, i) =>
      A.send(
        JSON.stringify({ t: 'asset-chunk', assetId: 'asset-http-test', index: i, total: parts.length, data: p }),
      ),
    )
    await sleep(800) // 等服务器落盘

    const base = `http://127.0.0.1:${PORT}/SuQCanvas/assets/asset-http-test`

    // 整文件 GET
    const full = await httpGet(base)
    expect(full.status).toBe(200)
    expect(full.headers['accept-ranges']).toBe('bytes')
    expect(full.headers['content-type']).toBe('video/mp4')
    // 封面抓帧的跨源视频元素需要 CORS 头，否则 canvas 被污染无法生成封面
    expect(full.headers['access-control-allow-origin']).toBe('*')
    expect(full.body.length).toBe(len)
    expect(Array.from(full.body.subarray(0, 64))).toEqual(Array.from(src.subarray(0, 64)))

    // Range 请求
    const range = await httpGet(base, { Range: 'bytes=10-19' })
    expect(range.status).toBe(206)
    expect(range.headers['content-range']).toBe(`bytes 10-19/${len}`)
    expect(Array.from(range.body)).toEqual(Array.from(src.subarray(10, 20)))

    // 不存在的资产
    const missing = await httpGet(`http://127.0.0.1:${PORT}/SuQCanvas/assets/asset-http-missing`)
    expect(missing.status).toBe(404)

    // 客户端请求该视频：服务器应返回 asset-http 通知，客户端记录 HTTP 拉流地址
    await requestAssetFromLan('asset-http-test')
    await sleep(500)
    expect(getLanAssetHttpUrl('asset-http-test')).toBe(
      `http://127.0.0.1:${PORT}/SuQCanvas/assets/asset-http-test`,
    )
  }, 15000)

  it('视频默认请求不整份下发分片；forceBlob 才整份下发（内容一致）', async () => {
    const len = CHUNK * 2 + 7 // 3 个分片
    const src = new Uint8Array(len)
    for (let i = 0; i < len; i++) src[i] = (i * 5 + 9) % 256
    const parts = encodeChunks(src)
    const assetW = { id: 'asset-video-w', name: 'w.mp4', mime: 'video/mp4', size: src.length, kind: 'video' }
    A.send(JSON.stringify({ t: 'asset-meta', asset: assetW, totalChunks: parts.length }))
    parts.forEach((p, i) =>
      A.send(
        JSON.stringify({ t: 'asset-chunk', assetId: 'asset-video-w', index: i, total: parts.length, data: p }),
      ),
    )
    await sleep(800) // 等服务器落盘

    // 默认请求：只回 asset-http + asset-meta，不（再）整份下发分片
    const probe = new WebSocket(`ws://127.0.0.1:${PORT}/lan-ws`)
    await new Promise<void>((resolve, reject) => {
      probe.once('open', resolve)
      probe.once('error', reject)
    })
    probe.send(JSON.stringify({ t: 'join-project', projectId: 'test-project' }))
    await sleep(100)
    const defaultGot: string[] = []
    probe.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.t === 'asset-chunk' && msg.assetId === 'asset-video-w') defaultGot.push(msg.data)
    })
    probe.send(JSON.stringify({ t: 'asset-request', assetId: 'asset-video-w' }))
    await sleep(700)
    expect(defaultGot).toHaveLength(0)
    probe.close()

    // forceBlob 请求：整份分片下发，拼回后与源一致
    const blob = new WebSocket(`ws://127.0.0.1:${PORT}/lan-ws`)
    await new Promise<void>((resolve, reject) => {
      blob.once('open', resolve)
      blob.once('error', reject)
    })
    blob.send(JSON.stringify({ t: 'join-project', projectId: 'test-project' }))
    await sleep(100)
    const chunks = new Map<number, string>()
    blob.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.t === 'asset-chunk' && msg.assetId === 'asset-video-w') chunks.set(Number(msg.index), msg.data)
    })
    blob.send(JSON.stringify({ t: 'asset-request', assetId: 'asset-video-w', forceBlob: true }))
    await waitFor(() => chunks.size === parts.length, 15000)
    const rebuilt = decodeChunks(parts.map((_, i) => chunks.get(i)!))
    expect(Array.from(rebuilt)).toEqual(Array.from(src))
    blob.close()
  }, 30000)
})

describe('LAN 封面随资产同步', () => {
  async function waitPersistedThumb(assetId: string, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs
    let rec = await db.assets.get(assetId)
    while (!rec?.thumbnail && Date.now() < deadline) {
      await sleep(150)
      rec = await db.assets.get(assetId)
    }
    return rec
  }

  it('中继缓存封面后随 asset-request 一并下发，观看端无需重新抓帧', async () => {
    const thumb = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04])
    const len = CHUNK + 50
    const src = new Uint8Array(len)
    for (let i = 0; i < len; i++) src[i] = (i * 11 + 3) % 256
    const parts = encodeChunks(src)
    const assetT = { id: 'asset-thumb-sync', name: 't.mp4', mime: 'video/mp4', size: src.length, kind: 'video' }

    // 上传端：封面（to: server）先于 meta 与分片发出
    A.send(
      JSON.stringify({
        t: 'asset-thumb',
        to: 'server',
        assetId: assetT.id,
        mime: 'image/jpeg',
        data: bufToB64(thumb),
      }),
    )
    A.send(JSON.stringify({ t: 'asset-meta', to: 'server', asset: assetT, totalChunks: parts.length }))
    parts.forEach((p, i) =>
      A.send(
        JSON.stringify({ t: 'asset-chunk', to: 'server', assetId: assetT.id, index: i, total: parts.length, data: p }),
      ),
    )
    await sleep(800) // 等服务器落盘

    await requestAssetFromLan('asset-thumb-sync')
    await waitFor(() => !!getLanAssetThumbnail('asset-thumb-sync'), 5000)
    const got = new Uint8Array(await getLanAssetThumbnail('asset-thumb-sync')!.arrayBuffer())
    expect(Array.from(got)).toEqual(Array.from(thumb))

    // 节点真正调用的入口：直接命中同步来的封面，不再走视频解码抓帧
    expect((await getThumbnailUrl('asset-thumb-sync'))?.startsWith('blob:')).toBe(true)

    // 封面同时落到 meta-only 记录上，刷新后读库即可，不必再依赖内存缓存
    const rec = await waitPersistedThumb('asset-thumb-sync')
    expect(rec?.thumbnail instanceof Blob).toBe(true)
    expect(rec?.blob).toBeUndefined()
  }, 20000)

  it('pushAssetToLan 把封面与视频一起交给中继缓存', async () => {
    const thumbBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x10, 0x11, 0x12])
    const thumb = new Blob([thumbBytes], { type: 'image/jpeg' })
    const src = new Uint8Array(CHUNK + 33)
    for (let i = 0; i < src.length; i++) src[i] = (i * 17 + 5) % 256
    const file = new Blob([src], { type: 'video/mp4' })
    await pushAssetToLan(
      { id: 'asset-push-thumb', name: 'p.mp4', mime: 'video/mp4', size: file.size, kind: 'video' },
      file,
      thumb,
    )
    await sleep(800)
    const key = createHash('sha256').update('asset-push-thumb').digest('hex')
    const cached = await readFile(join(dataDir, 'assets', `${key}.thumb`))
    expect(Array.from(cached)).toEqual(Array.from(thumbBytes))
    expect((await stat(join(dataDir, 'assets', `${key}.bin`))).size).toBe(file.size)
  }, 20000)

  it('历史视频（中继无 .thumb）能由本地封面补推自愈', async () => {
    const legacy = { id: 'asset-legacy', name: 'old.mp4', mime: 'video/mp4', size: 64, kind: 'video' as const }
    const src = new Uint8Array(64)
    A.send(JSON.stringify({ t: 'asset-meta', to: 'server', asset: legacy, totalChunks: 1 }))
    A.send(
      JSON.stringify({ t: 'asset-chunk', to: 'server', assetId: legacy.id, index: 0, total: 1, data: bufToB64(src) }),
    )
    await sleep(600)
    const key = createHash('sha256').update(legacy.id).digest('hex')
    const thumbPath = join(dataDir, 'assets', `${key}.thumb`)
    // 只推了视频、没推封面：中继上不该有 .thumb
    await expect(readFile(thumbPath)).rejects.toThrow()

    // 本地记录补上封面（等价于改动前导入、封面只存在于上传端 IndexedDB 的历史视频）
    const legacyThumb = new Uint8Array([0xff, 0xd8, 0xff, 0xed, 0x07])
    await db.assets.put({
      ...legacy,
      blob: new Blob([src], { type: 'video/mp4' }),
      thumbnail: new Blob([legacyThumb], { type: 'image/jpeg' }),
    })
    pushThumbnailToServer(legacy.id, (await db.assets.get(legacy.id))!.thumbnail!)
    await sleep(600)
    const cached = await readFile(thumbPath)
    expect(Array.from(cached)).toEqual(Array.from(legacyThumb))
  }, 20000)

  it('广播路径的封面会补写进已存在的素材记录', async () => {
    const thumb = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x0a, 0x0b])
    A.send(
      JSON.stringify({
        t: 'asset-thumb',
        assetId: 'asset-X',
        mime: 'image/jpeg',
        data: bufToB64(thumb),
      }),
    )
    const rec = await waitPersistedThumb('asset-X')
    expect(rec?.blob instanceof Blob).toBe(true)
    const got = new Uint8Array(await rec!.thumbnail!.arrayBuffer())
    expect(Array.from(got)).toEqual(Array.from(thumb))
  }, 10000)
})

describe('LAN 协作项目', () => {
  it('为同时在线的协作者分配不同颜色', () => {
    const users = useLanStore.getState().users
    expect(users.length).toBeGreaterThanOrEqual(2)
    expect(new Set(users.map((user) => user.color)).size).toBe(users.length)
    for (const user of users) expect(user.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('将项目快照持久保存到中继主机', async () => {
    A.send(
      JSON.stringify({
        t: 'project-save',
        project: {
          id: 'test-project',
          name: '共享项目',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          graph: { nodes: [], edges: [] },
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      }),
    )
    await sleep(400)
    const projects = JSON.parse(await readFile(join(dataDir, 'projects.json'), 'utf8'))
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('共享项目')
  })

  it('不同项目房间不会互相转发画布消息', async () => {
    const other = new WebSocket(`ws://127.0.0.1:${PORT}/lan-ws`)
    await new Promise<void>((resolve, reject) => {
      other.once('open', resolve)
      other.once('error', reject)
    })
    other.send(JSON.stringify({ t: 'hello', name: 'device-C' }))
    other.send(JSON.stringify({ t: 'join-project', projectId: 'other-project' }))
    await sleep(100)

    let leaked = false
    const listener = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString())
      if (msg.t === 'sync' && msg.projectId === 'other-project') leaked = true
    }
    A.on('message', listener)
    other.send(
      JSON.stringify({
        t: 'sync',
        projectId: 'other-project',
        nodes: [],
        edges: [],
      }),
    )
    await sleep(250)
    A.off('message', listener)
    other.close()
    expect(leaked).toBe(false)
  })
})

describe('LAN 画布并集合并与显式删除', () => {
  const node = (id: string, label = id): SuqNode => ({
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { kind: 'text', label },
  })

  beforeEach(() => {
    useCanvasStore.getState().reset()
    useCanvasStore.getState().clearHistory()
  })

  it('并集合并：本地与远端节点共存，同名节点以远端为准', async () => {
    useCanvasStore.getState().addNodes([node('n-local'), node('n-shared', '本地')])
    A.send(
      JSON.stringify({
        t: 'sync',
        projectId: 'test-project',
        nodes: [node('n-remote'), node('n-shared', '远端更新')],
        edges: [],
      }),
    )
    await waitFor(() => useCanvasStore.getState().nodes.some((n) => n.id === 'n-remote'), 3000)
    const ids = useCanvasStore.getState().nodes.map((n) => n.id)
    expect(ids).toContain('n-local')
    expect(ids).toContain('n-remote')
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n-shared')?.data.label).toBe('远端更新')
  })

  it('显式删除：sync-del 移除对应节点，晚到的旧快照不会复活它', async () => {
    useCanvasStore.getState().addNodes([node('n-a'), node('n-b')])
    A.send(JSON.stringify({ t: 'sync-del', projectId: 'test-project', nodeIds: ['n-a'], edgeIds: [] }))
    await waitFor(() => !useCanvasStore.getState().nodes.some((n) => n.id === 'n-a'), 3000)
    expect(useCanvasStore.getState().nodes.some((n) => n.id === 'n-b')).toBe(true)
    // 删除后的墓碑窗口内,晚到的旧快照即使包含 n-a 也不应复活它
    A.send(
      JSON.stringify({
        t: 'sync',
        projectId: 'test-project',
        nodes: [node('n-a'), node('n-c')],
        edges: [],
      }),
    )
    await waitFor(() => useCanvasStore.getState().nodes.some((n) => n.id === 'n-c'), 3000)
    const nodes = useCanvasStore.getState().nodes
    expect(nodes.some((n) => n.id === 'n-a')).toBe(false)
    expect(nodes.some((n) => n.id === 'n-b')).toBe(true)
  })
})

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(150)
  }
  throw new Error(`等待超时（${timeoutMs}ms）`)
}

describe('LAN 断线自动重连', () => {
  it('中继服务器重启后无需手动操作自动恢复连接', async () => {
    lanDisconnect()
    await sleep(300)

    const retryPort = PORT + 1
    const retryDir = await mkdtemp(join(tmpdir(), 'suqcanvas-lan-retry-'))
    let retryServer = spawn('node', ['server/lan-server.mjs'], {
      env: { ...process.env, PORT: String(retryPort), LAN_DATA_DIR: retryDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    retryServer.stderr?.on('data', (d) => process.stderr.write(`[retry-server] ${d}`))
    try {
      await connectWhenReady(`ws://127.0.0.1:${retryPort}/lan-ws`).then((sock) => sock.close())
      expect(lanConnect(`ws://127.0.0.1:${retryPort}/lan-ws`, 'device-B')).toBe(true)
      await waitFor(() => useLanStore.getState().status === 'connected', 5000)

      // 杀掉中继模拟部署重启，断开后进入自动重连
      retryServer.kill()
      await waitFor(() => useLanStore.getState().status !== 'connected', 6000)

      // 重启中继，客户端应在退避重试中自动恢复
      retryServer = spawn('node', ['server/lan-server.mjs'], {
        env: { ...process.env, PORT: String(retryPort), LAN_DATA_DIR: retryDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      retryServer.stderr?.on('data', (d) => process.stderr.write(`[retry-server] ${d}`))
      await waitFor(() => useLanStore.getState().status === 'connected', 20000)
    } finally {
      retryServer?.kill()
      await rm(retryDir, { recursive: true, force: true })
    }
  }, 40000)
})
