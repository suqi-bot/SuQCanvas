import { create } from 'zustand'
import type { Viewport } from '@xyflow/react'

export interface LanUser {
  id: string
  name: string
  ip: string
  color: string
  projectId?: string | null
}

export type LanStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface LanProjectMeta {
  id: string
  name: string
  updatedAt: number
  ownerId: string
}

export interface LanCursor {
  userId: string
  name: string
  color: string
  x: number
  y: number
  updatedAt: number
}

export interface LanEditing {
  userId: string
  name: string
  color: string
  nodeId: string
  label: string
  updatedAt: number
}

export type LanActivityKind = 'create' | 'delete' | 'move' | 'edit' | 'connect' | 'change'

export interface LanActivity {
  id: string
  userId: string
  name: string
  color: string
  kind: LanActivityKind
  message: string
  nodeId?: string
  createdAt: number
}

interface LanState {
  status: LanStatus
  url: string
  name: string
  selfId: string
  users: LanUser[]
  followId: string | null
  remoteViewport: Viewport | null
  activeProjectId: string | null
  remoteProjects: LanProjectMeta[]
  cursors: Record<string, LanCursor>
  editing: Record<string, LanEditing>
  activities: LanActivity[]
  setStatus: (s: LanStatus) => void
  setUrl: (url: string) => void
  setName: (name: string) => void
  setSelfId: (id: string) => void
  setUsers: (users: LanUser[]) => void
  removeUser: (id: string) => void
  setFollowId: (id: string | null) => void
  setRemoteViewport: (vp: Viewport) => void
  clearRemoteViewport: () => void
  setActiveProjectId: (id: string | null) => void
  setSharedProjects: (projects: Array<{ id: string; name: string; updatedAt: number }>) => void
  setCursor: (cursor: LanCursor) => void
  removeCursor: (userId: string) => void
  setEditing: (editing: LanEditing) => void
  clearEditing: (userId: string) => void
  addActivity: (activity: LanActivity) => void
  clearCollaborationState: () => void
  mergeRemoteProjects: (
    ownerId: string,
    projects: Array<{ id: string; name: string; updatedAt: number }>,
  ) => void
  removeRemoteProjectsByOwner: (ownerId: string) => void
  clearRemoteProjects: () => void
}

export const useLanStore = create<LanState>((set) => ({
  status: 'idle',
  url: '',
  name: '',
  selfId: '',
  users: [],
  followId: null,
  remoteViewport: null,
  activeProjectId: null,
  remoteProjects: [],
  cursors: {},
  editing: {},
  activities: [],

  setStatus: (status) => set({ status }),
  setUrl: (url) => set({ url }),
  setName: (name) => set({ name }),
  setSelfId: (selfId) => set({ selfId }),
  setUsers: (users) => set({ users }),
  removeUser: (id) =>
    set((s) => ({
      users: s.users.filter((u) => u.id !== id),
      followId: s.followId === id ? null : s.followId,
    })),
  setFollowId: (followId) => set({ followId }),
  setRemoteViewport: (remoteViewport) => set({ remoteViewport }),
  clearRemoteViewport: () => set({ remoteViewport: null }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setSharedProjects: (projects) =>
    set({
      remoteProjects: projects
        .filter((p) => p?.id)
        .map((p) => ({ ...p, ownerId: 'server' }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }),
  setCursor: (cursor) =>
    set((state) => ({ cursors: { ...state.cursors, [cursor.userId]: cursor } })),
  removeCursor: (userId) =>
    set((state) => {
      const cursors = { ...state.cursors }
      delete cursors[userId]
      return { cursors }
    }),
  setEditing: (editing) =>
    set((state) => ({ editing: { ...state.editing, [editing.userId]: editing } })),
  clearEditing: (userId) =>
    set((state) => {
      const editing = { ...state.editing }
      delete editing[userId]
      return { editing }
    }),
  addActivity: (activity) =>
    set((state) => ({ activities: [...state.activities, activity].slice(-100) })),
  clearCollaborationState: () => set({ cursors: {}, editing: {}, activities: [] }),
  mergeRemoteProjects: (ownerId, projects) =>
    set((s) => {
      const others = s.remoteProjects.filter((p) => p.ownerId !== ownerId)
      const map = new Map(others.map((p) => [p.id, p]))
      for (const p of projects) {
        if (!p?.id) continue
        const prev = map.get(p.id)
        if (!prev || p.updatedAt > prev.updatedAt) map.set(p.id, { ...p, ownerId })
      }
      return { remoteProjects: [...map.values()] }
    }),
  removeRemoteProjectsByOwner: (ownerId) =>
    set((s) => ({ remoteProjects: s.remoteProjects.filter((p) => p.ownerId !== ownerId) })),
  clearRemoteProjects: () => set({ remoteProjects: [] }),
}))
