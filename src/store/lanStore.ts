import { create } from 'zustand'
import type { Viewport } from '@xyflow/react'

export interface LanUser {
  id: string
  name: string
  ip: string
}

export type LanStatus = 'idle' | 'connecting' | 'connected' | 'error'

interface LanState {
  status: LanStatus
  url: string
  name: string
  selfId: string
  users: LanUser[]
  followId: string | null
  remoteViewport: Viewport | null
  setStatus: (s: LanStatus) => void
  setUrl: (url: string) => void
  setName: (name: string) => void
  setSelfId: (id: string) => void
  setUsers: (users: LanUser[]) => void
  removeUser: (id: string) => void
  setFollowId: (id: string | null) => void
  setRemoteViewport: (vp: Viewport) => void
  clearRemoteViewport: () => void
}

export const useLanStore = create<LanState>((set) => ({
  status: 'idle',
  url: '',
  name: '',
  selfId: '',
  users: [],
  followId: null,
  remoteViewport: null,

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
}))
