import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: { user: { id: 'owner' }, access_token: 'user-access-token' } as { user: { id: string }; access_token: string } | null,
  fetch: vi.fn(), put: vi.fn(), multipart: vi.fn(),
  config: { url: 'https://cloud.test', key: 'public-api-key', region: 'oss-cn-hangzhou', bucket: 'test-bucket', stsUrl: 'https://cloud.test/functions/v1/oss-sts' },
}))
vi.mock('./cloudClient', () => ({
  desktopCloudConfig: state.config,
  getDesktopCloudClient: () => ({ auth: { getSession: async () => ({ data: { session: state.session }, error: null }) } }),
}))
vi.mock('ali-oss', () => ({ default: class {
  signatureUrl(key: string) { return `https://test-bucket.example/${key}?signed=1` }
  put = state.put
  multipartUpload = state.multipart
} }))

beforeEach(() => {
  vi.resetModules()
  state.session = { user: { id: 'owner' }, access_token: 'user-access-token' }
  state.put.mockReset().mockResolvedValue({})
  state.multipart.mockReset().mockResolvedValue({})
  state.fetch.mockReset().mockImplementation(async (url: string) => String(url).includes('oss-sts')
    ? Response.json({ accessKeyId: 'temporary-id', accessKeySecret: 'temporary-secret', securityToken: 'temporary-token', expiration: new Date(Date.now() + 3600000).toISOString() })
    : new Response('asset', { headers: { 'content-type': 'application/octet-stream' } }))
  vi.stubGlobal('fetch', state.fetch)
})
afterEach(() => vi.unstubAllGlobals())

describe('桌面云端素材读取', () => {
  it('上传使用当前账号临时凭证，小文件直接写入，大文件分片', async () => {
    const { writeCloudObject } = await import('./cloudStorage')
    const small = new Blob(['asset'], { type: 'image/png' })
    await writeCloudObject('assets/new.bin', small, 'owner')
    expect(state.put).toHaveBeenCalledWith('assets/new.bin', small, { mime: 'image/png' })
    const large = new Blob([new Uint8Array(10 * 1024 * 1024)])
    await writeCloudObject('assets/large.bin', large, 'owner')
    expect(state.multipart).toHaveBeenCalledWith('assets/large.bin', large, expect.objectContaining({ parallel: 4 }))
  })

  it('拒绝以其他账号上传或使用无效对象路径', async () => {
    const { writeCloudObject } = await import('./cloudStorage')
    await expect(writeCloudObject('assets/new.bin', new Blob(), 'other')).rejects.toThrow('账号已切换')
    await expect(writeCloudObject('../new.bin', new Blob(), 'owner')).rejects.toThrow('路径无效')
    expect(state.fetch).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
  })
  it('使用当前登录令牌获取临时凭证，下载按素材记录中的 key 定位', async () => {
    const { readCloudObject } = await import('./cloudStorage')
    const blob = await readCloudObject('historical/file.bin', 'video/mp4')
    expect(await blob.text()).toBe('asset')
    expect(blob.type).toBe('video/mp4')
    expect(state.fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer user-access-token', apikey: 'public-api-key' })
    expect(state.fetch.mock.calls[1][0]).toBe('https://test-bucket.example/historical/file.bin?signed=1')
    await readCloudObject('historical/file.thumb', 'image/jpeg')
    expect(state.fetch.mock.calls.filter(([url]) => String(url).includes('oss-sts'))).toHaveLength(1)
  })

  it('切换账号后不复用前一个账号的素材凭证', async () => {
    const { readCloudObject } = await import('./cloudStorage')
    await readCloudObject('file.bin', 'video/mp4')
    state.session = { user: { id: 'other' }, access_token: 'other-token' }
    await readCloudObject('file.bin', 'video/mp4')
    const calls = state.fetch.mock.calls.filter(([url]) => String(url).includes('oss-sts'))
    expect(calls).toHaveLength(2)
    expect(calls[1][1].headers.Authorization).toBe('Bearer other-token')
  })

  it('未登录时拒绝素材下载', async () => {
    state.session = null
    const { readCloudObject } = await import('./cloudStorage')
    await expect(readCloudObject('file.bin', 'video/mp4')).rejects.toThrow('请先登录')
    expect(state.fetch).not.toHaveBeenCalled()
  })

  it('临时凭证服务失败时明确报错', async () => {
    state.fetch.mockResolvedValue(new Response('', { status: 401 }))
    const { readCloudObject } = await import('./cloudStorage')
    await expect(readCloudObject('file.bin', 'video/mp4')).rejects.toThrow('云端素材授权失败（401）')
  })
})
