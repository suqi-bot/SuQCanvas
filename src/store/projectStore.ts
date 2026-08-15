import { create } from 'zustand'
import { db } from '../db/db'
import { useCanvasStore } from './canvasStore'
import { toast } from './uiStore'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface ProjectState {
  projectId: string | null
  projectName: string
  loaded: boolean
  initialized: boolean
  saveStatus: SaveStatus
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

  init: async () => {
    if (get().initialized) return
    const latest = await db.projects.orderBy('updatedAt').last()
    if (latest) {
      useCanvasStore.setState({
        nodes: latest.graph.nodes,
        edges: latest.graph.edges,
        viewport: latest.viewport,
      })
      set({
        projectId: latest.id,
        projectName: latest.name,
        loaded: true,
        initialized: true,
        saveStatus: 'saved',
      })
    } else {
      const now = Date.now()
      const id = crypto.randomUUID()
      await db.projects.add({
        id,
        name: '未命名项目',
        createdAt: now,
        updatedAt: now,
        graph: { nodes: [], edges: [] },
        viewport: { x: 0, y: 0, zoom: 1 },
      })
      set({
        projectId: id,
        projectName: '未命名项目',
        loaded: true,
        initialized: true,
        saveStatus: 'saved',
      })
    }
    installAutosave()
  },

  loadProject: async (id) => {
    const record = await db.projects.get(id)
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
    set({
      projectId: id,
      projectName: record.name,
      loaded: true,
      saveStatus: 'saved',
    })
  },

  newProject: async (name = '未命名项目') => {
    if (get().loaded) await get().saveNow()
    useCanvasStore.getState().reset()
    const now = Date.now()
    const id = crypto.randomUUID()
    await db.projects.add({
      id,
      name,
      createdAt: now,
      updatedAt: now,
      graph: { nodes: [], edges: [] },
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    set({
      projectId: id,
      projectName: name,
      loaded: true,
      saveStatus: 'saved',
    })
  },

  renameProject: async (id, name) => {
    await db.projects.update(id, { name })
    if (get().projectId === id) set({ projectName: name })
  },

  saveNow: async () => {
    const { projectId, loaded } = get()
    if (!projectId || !loaded) return
    const { nodes, edges, viewport } = useCanvasStore.getState()
    set({ saveStatus: 'saving' })
    try {
      await db.projects.update(projectId, {
        graph: { nodes, edges },
        viewport,
        updatedAt: Date.now(),
      })
      set({ saveStatus: 'saved' })
    } catch (err) {
      console.error('保存失败', err)
      set({ saveStatus: 'error' })
      toast('自动保存失败', 'error')
    }
  },
}))
