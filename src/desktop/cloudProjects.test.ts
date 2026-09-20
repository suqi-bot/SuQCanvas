import 'fake-indexeddb/auto'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import type { CloudAsset, CloudProject } from '../sync/cloudSync'

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, read: vi.fn() }))
vi.mock('./cloudClient', () => ({ getDesktopCloudClient: () => state.client }))
vi.mock('./cloudStorage', () => ({ readCloudObject: state.read }))

import { downloadDesktopCloudProject, listDesktopCloudProjects } from './cloudProjects'

const remote: CloudProject = {
  id: 'remote-project', name: '云端测试', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  viewport: { x: 12, y: 34, zoom: 0.8 },
  graph: { edges: [], nodes: [
    { id: 'video', position: { x: 1, y: 2 }, data: { kind: 'video', assetId: 'video-asset', coverAssetId: 'cover-asset' } },
    { id: 'duplicate', position: { x: 4, y: 5 }, data: { kind: 'video', assetId: 'video-asset' } },
  ] },
}
const metadata: CloudAsset[] = [
  { id: 'video-asset', name: 'video.mp4', mime: 'video/mp4', size: 5, kind: 'video',
    oss_key: 'historical/video.bin', oss_thumb_key: 'historical/video.thumb', has_thumbnail: true, created_at: remote.created_at },
  { id: 'cover-asset', name: 'cover.png', mime: 'image/png', size: 5, kind: 'image',
    oss_key: 'historical/cover.bin', oss_thumb_key: null, has_thumbnail: false, created_at: remote.created_at },
]
let assets: CloudAsset[]
let projects: CloudProject[]
let failQuery: boolean
let owner: string | null
let requests: URL[]

beforeEach(async () => {
  await db.projects.clear()
  await db.assets.clear()
  await db.desktopCloudLinks.clear()
  assets = [...metadata]
  projects = [remote]
  failQuery = false
  owner = 'owner-a'
  requests = []
  state.client = createClient('https://cloud.test', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input))
      requests.push(url)
      if (failQuery) return new Response(JSON.stringify({ message: 'permission denied' }), { status: 403 })
      const data = url.pathname.endsWith('/assets') ? assets
        : url.searchParams.has('id') ? remote
          : projects.slice(Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('offset') ?? 0) + Number(url.searchParams.get('limit') ?? 100))
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
    } },
  })
  vi.spyOn(state.client.auth, 'getUser').mockImplementation(async () => ({
    data: { user: owner ? { id: owner } as User : null }, error: null,
  }) as Awaited<ReturnType<SupabaseClient['auth']['getUser']>>)
  state.read.mockReset().mockImplementation(async (key: string, mime: string) =>
    new Blob([key.endsWith('thumb') ? 'thumb' : key.includes('cover') ? 'cover' : 'video'], { type: mime }))
})

describe('桌面在线项目下载', () => {
  it('按当前账号查询，下载原文件和封面并创建独立本地项目', async () => {
    const existing = { id: remote.id, name: '保留本地项目', createdAt: 1, updatedAt: 1,
      viewport: remote.viewport, graph: { nodes: [], edges: [] } }
    await db.projects.add(existing)
    const copy = await downloadDesktopCloudProject(remote.id)
    expect(requests.every((url) => url.searchParams.get('user_id') === 'eq.owner-a')).toBe(true)
    expect(copy.id).not.toBe(remote.id)
    expect(copy.name).toBe('云端测试（云端副本）')
    expect(await db.desktopCloudLinks.get(copy.id)).toMatchObject({ owner: 'owner-a', projectId: remote.id, updatedAt: remote.updated_at })
    expect(copy.viewport).toEqual(remote.viewport)
    expect(copy.graph.nodes[0].data.assetId).toBe(copy.graph.nodes[1].data.assetId)
    expect(copy.graph.nodes[0].data.assetId).not.toBe('video-asset')
    const video = await db.assets.get(copy.graph.nodes[0].data.assetId!)
    expect(await video!.blob.text()).toBe('video')
    expect(await video!.thumbnail!.text()).toBe('thumb')
    expect(await db.assets.count()).toBe(2)
    expect(await db.projects.get(remote.id)).toEqual(existing)
    expect(state.read.mock.calls.map(([key]) => key)).toEqual(['historical/video.bin', 'historical/video.thumb', 'historical/cover.bin'])
  })

  it('元数据缺失时不写入空项目或部分素材', async () => {
    assets = []
    await expect(downloadDesktopCloudProject(remote.id)).rejects.toThrow('部分素材未上传')
    expect(state.read).not.toHaveBeenCalled()
    expect(await db.projects.count()).toBe(0)
    expect(await db.assets.count()).toBe(0)
  })

  it('后续素材损坏时整个下载不落库', async () => {
    state.read.mockImplementation(async (key: string) => new Blob([key.includes('cover') ? 'bad' : 'video']))
    await expect(downloadDesktopCloudProject(remote.id)).rejects.toThrow('素材下载不完整')
    expect(await db.projects.count()).toBe(0)
    expect(await db.assets.count()).toBe(0)
  })

  it('下载期间切换账号时拒绝提交', async () => {
    state.read.mockImplementation(async () => { owner = 'owner-b'; return new Blob(['video']) })
    await expect(downloadDesktopCloudProject(remote.id)).rejects.toThrow('账号已切换')
    expect(await db.projects.count()).toBe(0)
  })

  it('列表查询失败时显示错误而非空列表', async () => {
    failQuery = true
    await expect(listDesktopCloudProjects()).rejects.toThrow('读取云端项目失败')
  })

  it('分页获取完整云端项目列表', async () => {
    projects = Array.from({ length: 101 }, (_, index) => ({ ...remote, id: `project-${index}` }))
    expect(await listDesktopCloudProjects()).toHaveLength(101)
    expect(requests).toHaveLength(2)
    expect(requests[1].searchParams.get('offset')).toBe('100')
  })
})
