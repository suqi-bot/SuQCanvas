import 'fake-indexeddb/auto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { useCanvasStore } from '../store/canvasStore'
import { useLanStore } from '../store/lanStore'
import type { SuqNode } from '../types'
import {
  getDefaultLanUrl,
  joinLanProject,
  lanConnect,
  lanDisconnect,
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
