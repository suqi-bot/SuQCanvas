import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../buildMode', () => ({ IS_DESKTOP_BUILD: true, IS_LAN_BUILD: true, IS_ONLINE_BUILD: false }))

import { useAuthStore } from '../store/authStore'
import { useLanStore } from '../store/lanStore'
import { joinLanProject, saveProjectToLan } from '../sync/lanClient'
import { useProjectStore } from '../store/projectStore'
import { db } from '../db/db'

describe('桌面离线模式', () => {
  it('首次启动无需服务器配置或账号即可进入', async () => {
    await useAuthStore.getState().init()
    expect(useAuthStore.getState()).toMatchObject({ guest: true, loading: false, user: null })
  })

  it('创建和保存本地项目不加入服务器房间', async () => {
    await useProjectStore.getState().newProject('离线项目')
    const id = useProjectStore.getState().projectId!
    await useProjectStore.getState().saveNow()
    expect((await db.projects.get(id))?.name).toBe('离线项目')
    expect(useLanStore.getState().activeProjectId).toBeNull()
    joinLanProject(id)
    expect(useLanStore.getState().activeProjectId).toBeNull()
    expect(saveProjectToLan((await db.projects.get(id))!)).toBe(false)
  })
})
