import 'fake-indexeddb/auto'
import { spawn, type ChildProcess } from 'node:child_process'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { getDefaultLanUrl, lanConnect, requestAssetFromLan, bufToB64, b64ToUint8, resolveLanUrl } from './lanClient'

// ws 的 WebSocket 与 DOM 类型不同，运行时行为兼容
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket

const PORT = 9890
const CHUNK = 262143
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let server: ChildProcess
let A: WebSocket

beforeAll(async () => {
  server = spawn('node', ['server/lan-server.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`))
  await sleep(400)
  A = new WebSocket(`ws://127.0.0.1:${PORT}/lan-ws`)
  await new Promise<void>((res, rej) => {
    A.on('open', () => res())
    A.on('error', rej)
  })
  A.send(JSON.stringify({ t: 'hello', name: 'device-A' }))
  lanConnect(`ws://127.0.0.1:${PORT}/lan-ws`, 'device-B')
  await sleep(800)
}, 15000)

afterAll(() => {
  try {
    A?.close()
  } catch {
    // ignore
  }
  server?.kill()
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
