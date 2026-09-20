import 'fake-indexeddb/auto'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ProjectRecord } from '../db/db'
import { saveDesktopCloudProject, type CloudSaveTarget } from './saveCloudProject'

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, write: vi.fn() }))
vi.mock('./cloudClient', () => ({ getDesktopCloudClient: () => state.client }))
vi.mock('./cloudStorage', () => ({ writeCloudObject: state.write }))

const target: CloudSaveTarget = { owner: 'owner', projectId: 'remote', updatedAt: '2026-01-01T00:00:00Z', name: '云端原名' }
const local: ProjectRecord = { id: 'local', name: '本地副本', createdAt: 1, updatedAt: 2,
  viewport: { x: 1, y: 2, zoom: 0.5 }, graph: { edges: [], nodes: [
    { id: 'n', position: { x: 1, y: 2 }, data: { kind: 'video', assetId: 'asset', coverAssetId: 'cover' } },
    { id: 'n2', position: { x: 3, y: 4 }, data: { kind: 'video', assetId: 'asset' } },
  ] } }
let owner: string
let version: string | null
let race: boolean
let denyMetadata: boolean
let loseResponse: boolean
let requests: Array<{ url: URL; method: string; body: Record<string, unknown> }>

beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.assets.clear(), db.desktopCloudLinks.clear()])
  await db.projects.add(local)
  await db.assets.bulkAdd([
    { id: 'asset', name: 'video', kind: 'video', mime: 'video/mp4', size: 5, blob: new Blob(['video']), thumbnail: new Blob(['thumb']) },
    { id: 'cover', name: 'cover', kind: 'image', mime: 'image/png', size: 5, blob: new Blob(['cover']) },
  ])
  owner = 'owner'; version = target.updatedAt; race = false; denyMetadata = false; loseResponse = false; requests = []
  state.write.mockReset().mockResolvedValue(undefined)
  state.client = createClient('https://cloud.test', 'public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ url, method, body })
      if (url.pathname.endsWith('/assets')) return denyMetadata
        ? Response.json({ message: 'denied' }, { status: 403 }) : new Response(null, { status: 201 })
      if (method === 'GET') return Response.json(version ? { id: target.projectId, updated_at: version } : null)
      if (race) return Response.json([])
      version = '2026-02-01T00:00:00.123456Z'
      if (loseResponse) return Response.json({ message: 'response lost' }, { status: 400 })
      return Response.json({ id: body.id ?? target.projectId, updated_at: version })
    } },
  })
  vi.spyOn(state.client.auth, 'getUser').mockImplementation(async () => ({
    data: { user: { id: owner } as User }, error: null,
  }) as Awaited<ReturnType<SupabaseClient['auth']['getUser']>>)
})

const commits = () => requests.filter((r) => r.url.pathname.endsWith('/projects') && r.method !== 'GET')

describe('手动保存到云端', () => {
  it('素材和封面先上传，重映射共享引用，按旧版本更新原项目并记录服务端版本', async () => {
    state.write.mockImplementation(async () => { expect(commits()).toHaveLength(0) })
    await saveDesktopCloudProject(local.id, target)
    expect(state.write).toHaveBeenCalledTimes(3)
    const commit = commits()[0]
    expect(commit.method).toBe('PATCH')
    expect(commit.url.searchParams.get('user_id')).toBe('eq.owner')
    expect(commit.url.searchParams.get('id')).toBe('eq.remote')
    expect(commit.url.searchParams.get('updated_at')).toBe(`eq.${target.updatedAt}`)
    expect(commit.body.name).toBe('云端原名')
    const graph = commit.body.graph as ProjectRecord['graph']
    expect(graph.nodes[0].data.assetId).toBe(graph.nodes[1].data.assetId)
    expect(graph.nodes[0].data.assetId).not.toBe('asset')
    expect(graph.nodes[0].data.coverAssetId).not.toBe('cover')
    expect(await db.projects.get('local')).toEqual(local)
    expect((await db.desktopCloudLinks.get('local'))?.updatedAt).toBe(version)
    expect(requests.filter((r) => r.url.pathname.endsWith('/assets'))).toHaveLength(2)
  })

  it('缺失本地素材时不执行任何远端写入', async () => {
    await db.assets.delete('cover')
    await expect(saveDesktopCloudProject('local', target)).rejects.toThrow('本地素材缺失')
    expect(state.write).not.toHaveBeenCalled()
    expect(commits()).toHaveLength(0)
  })

  it('上传中断或素材元数据写入失败不改变云端画布', async () => {
    state.write.mockRejectedValueOnce(new Error('network offline'))
    await expect(saveDesktopCloudProject('local', target)).rejects.toThrow('network offline')
    expect(commits()).toHaveLength(0)
    denyMetadata = true
    await expect(saveDesktopCloudProject('local', target)).rejects.toThrow('保存素材信息失败')
    expect(commits()).toHaveLength(0)
  })

  it('云端已有新版本时在上传前停止', async () => {
    version = 'newer'
    await expect(saveDesktopCloudProject('local', target)).rejects.toThrow('云端项目已修改')
    expect(state.write).not.toHaveBeenCalled()
  })

  it('上传期间云端修改导致条件更新零行时不能报告成功', async () => {
    race = true
    await expect(saveDesktopCloudProject('local', target)).rejects.toThrow('云端项目已修改')
    expect(await db.desktopCloudLinks.get('local')).toBeUndefined()
  })

  it('上传期间切换账号时不提交素材元数据或画布', async () => {
    state.write.mockImplementation(async () => { owner = 'other' })
    await expect(saveDesktopCloudProject('local', target)).rejects.toThrow('账号已切换')
    expect(requests.filter((r) => r.method !== 'GET')).toHaveLength(0)
  })

  it('未关联的本地项目创建独立云端记录', async () => {
    version = null
    await saveDesktopCloudProject('local', { ...target, projectId: 'new-id', updatedAt: null })
    expect(commits()[0].method).toBe('POST')
    expect(commits()[0].body.id).toBe('new-id')
    expect(commits()[0].body.user_id).toBe('owner')
    expect((await db.desktopCloudLinks.get('local'))?.projectId).toBe('new-id')
  })

  it('首次创建响应丢失后保留目标 ID，重试不会覆盖或再创建', async () => {
    version = null; loseResponse = true
    const fresh = { ...target, updatedAt: null }
    await expect(saveDesktopCloudProject('local', fresh)).rejects.toThrow('云端保存未确认')
    expect((await db.desktopCloudLinks.get('local'))?.projectId).toBe('remote')
    await expect(saveDesktopCloudProject('local', fresh)).rejects.toThrow('云端项目已修改')
    expect(commits()).toHaveLength(1)
  })
})
