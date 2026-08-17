import { create } from 'zustand'
import { db } from '../db/db'
import { useCanvasStore } from './canvasStore'
import { toast } from './uiStore'
import { genUuid } from '../utils/uuid'
import {
  loadProjectBest,
  syncProjectList,
  updateProjectNameInCloud,
  upsertProjectToCloud,
} from '../sync/cloudSync'
import { broadcastLocalProjects } from '../sync/lanClient'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface ProjectState {
  projectId: string | null
  projectName: string
  loaded: boolean
  initialized: boolean
  saveStatus: SaveStatus
  busy: boolean
  setBusy: (busy: boolean) => void
  init: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  newProject: (name?: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  saveNow: () => Promise<void>
}

const AUTOSAVE_DELAY = 500

let saveTimer: ReturnType<typeof setTimeout> | undefined
let autosaveInstalled = false

function installAutosave(): void {
  if (autosaveInstalled) return
  autosaveInstalled = true
  useCanvasStore.subscribe((state, prev) => {
    if (
      state.nodes === prev.nodes &&
      state.edges === prev.edges &&
      state.viewport === prev.viewport
    ) {
      return
    }
    const project = useProjectStore.getState()
    if (!project.loaded) return
    if (project.saveStatus !== 'idle') {
      useProjectStore.setState({ saveStatus: 'idle' })
    }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void useProjectStore.getState().saveNow()
    }, AUTOSAVE_DELAY)
  })
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  projectName: '未命名项目',
  loaded: false,
  initialized: false,
  saveStatus: 'idle',
  busy: false,

  setBusy: (busy) => {
    set({ busy })
  },

  init: async () => {
    if (get().initialized) return
    set({ busy: true })
    try {
      const list = await syncProjectList()
      const latest = list[0]
      if (latest) {
        useCanvasStore.setState({
          nodes: latest.graph.nodes,
          edges: latest.graph.edges,
          viewport: latest.viewport,
        })
        useCanvasStore.getState().clearHistory()
        set({
          projectId: latest.id,
          projectName: latest.name,
          loaded: true,
          initialized: true,
          saveStatus: 'saved',
        })
      } else {
        useCanvasStore.getState().reset()
        useCanvasStore.getState().clearHistory()
        set({
          projectId: null,
          projectName: '未命名项目',
          loaded: false,
          initialized: true,
          saveStatus: 'idle',
        })
      }
      installAutosave()
    } finally {
      set({ busy: false })
    }
  },

  loadProject: async (id) => {
    set({ busy: true })
    try {
      const record = await loadProjectBest(id)
      if (!record) {
        toast('项目不存在', 'error')
        return
      }
      if (get().loaded) await get().saveNow()
      useCanvasStore.setState({
        nodes: record.graph.nodes,
        edges: record.graph.edges,
        viewport: record.viewport,
      })
      useCanvasStore.getState().clearHistory()
      set({
        projectId: id,
        projectName: record.name,
        loaded: true,
        saveStatus: 'saved',
      })
    } catch (err) {
      console.error('打开项目失败', err)
      toast('打开项目失败', 'error')
    } finally {
      set({ busy: false })
    }
  },

  newProject: async (name = '未命名项目') => {
    set({ busy: true })
    try {
      if (get().loaded) await get().saveNow()
      useCanvasStore.getState().reset()
      useCanvasStore.getState().clearHistory()
      const now = Date.now()
      const id = genUuid()
      const record = {
        id,
        name,
        createdAt: now,
        updatedAt: now,
        graph: { nodes: [], edges: [] },
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      await db.projects.add(record)
      await upsertProjectToCloud(record)
      set({
        projectId: id,
        projectName: name,
        loaded: true,
        saveStatus: 'saved',
      })
      void broadcastLocalProjects()
    } finally {
      set({ busy: false })
    }
  },

  renameProject: async (id, name) => {
    await db.projects.update(id, { name })
    await updateProjectNameInCloud(id, name)
    if (get().projectId === id) set({ projectName: name })
    void broadcastLocalProjects()
  },

  saveNow: async () => {
    const { projectId, loaded } = get()
    if (!projectId || !loaded) return
    const { nodes, edges, viewport } = useCanvasStore.getState()
    const record = {
      id: projectId,
      name: get().projectName,
      createdAt: 0,
      updatedAt: Date.now(),
      graph: { nodes, edges },
      viewport,
    }
    set({ saveStatus: 'saving' })
    try {
      await db.projects.update(projectId, {
        name: record.name,
        graph: record.graph,
        viewport,
        updatedAt: record.updatedAt,
      })
      await upsertProjectToCloud(record)
      set({ saveStatus: 'saved' })
      void broadcastLocalProjects()
    } catch (err) {
      console.error('保存失败', err)
      set({ saveStatus: 'error' })
      toast('自动保存失败', 'error')
    }
  },
}))
