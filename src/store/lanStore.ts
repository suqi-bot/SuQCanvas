import { create } from 'zustand'
import type { Viewport } from '@xyflow/react'

export interface LanUser {
  id: string
  name: string
  ip: string
}

export type LanStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface LanProjectMeta {
  id: string
  name: string
  updatedAt: number
  ownerId: string
}

interface LanState {
  status: LanStatus
  url: string
  name: string
  selfId: string
  users: LanUser[]
  followId: string | null
  remoteViewport: Viewport | null
  remoteProjects: LanProjectMeta[]
  setStatus: (s: LanStatus) => void
  setUrl: (url: string) => void
  setName: (name: string) => void
  setSelfId: (id: string) => void
  setUsers: (users: LanUser[]) => void
  removeUser: (id: string) => void
  setFollowId: (id: string | null) => void
  setRemoteViewport: (vp: Viewport) => void
  clearRemoteViewport: () => void
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
  remoteProjects: [],

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
