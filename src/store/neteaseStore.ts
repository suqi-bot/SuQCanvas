import { create } from 'zustand'
import { neteaseUrlFor, type NeteaseRef } from '../media/netease'
import { setExternalSourcePauseHook, usePlayerStore } from './playerStore'
import { toast } from './uiStore'

export interface NeteaseBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface NeteaseLikedSong {
  id: string
  name: string
  artist?: string
  coverUrl?: string
}

export interface NeteasePlaylist {
  id: string
  name: string
  trackCount?: number
  coverUrl?: string
  specialType?: number
}

export interface NeteaseLikedList {
  playlistId: string
  playlistName: string
  songs: NeteaseLikedSong[]
  updatedAt: number
}

interface NeteaseState {
  open: boolean
  setOpen: (open: boolean) => void
  target: NeteaseRef
  setTarget: (ref: NeteaseRef) => void
  openPanel: (ref?: NeteaseRef | string | null, opts?: { keepLocal?: boolean }) => Promise<void>
  closePanel: () => void
  syncLayout: (bounds: NeteaseBounds) => void
  pauseExternal: () => void
  /** 全部歌单 */
  playlists: NeteasePlaylist[]
  playlistsLoading: boolean
  playlistsError: string | null
  selectedPlaylistId: string | null
  /** 当前选中歌单的歌曲 */
  liked: NeteaseLikedList | null
  likedLoading: boolean
  likedError: string | null
  refreshPlaylists: () => Promise<void>
  /** 兼容旧调用：刷新全部歌单 */
  refreshLiked: () => Promise<void>
  selectPlaylist: (playlistId: string) => Promise<void>
  playLikedSong: (id: string) => void
  /** 画布/列表点播指定歌曲（专用链路，避免误点第一首） */
  playSong: (songId: string) => Promise<void>
  /** 网易云侧当前曲（画布节点用来显示进度/暂停） */
  activeSongId: string | null
  externalPlaying: boolean
  externalTime: number
  externalDuration: number
  externalProgress: number
  /** 读一次页内状态并写入 store；返回是否成功 */
  pollPlayback: () => Promise<boolean>
  /** 同一首：暂停/继续；否则当播放 */
  toggleSong: (songId: string) => Promise<void>
  searchQuery: string
  searchResults: NeteaseLikedSong[] | null
  searchLoading: boolean
  searchError: string | null
  setSearchQuery: (q: string) => void
  runSearch: () => Promise<void>
  clearSearch: () => void
  loginVisible: boolean
  showLogin: () => Promise<void>
  hideLogin: () => Promise<void>
  loggedIn: boolean | null
  checkLogin: () => Promise<void>
}

function toRef(input?: NeteaseRef | string | null): NeteaseRef {
  if (!input) return { type: 'home' }
  if (typeof input === 'string') {
    const raw = input.trim()
    if (/^\d+$/.test(raw)) return { type: 'song', id: raw }
    try {
      const url = new URL(raw)
      const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
      const combined = `${url.pathname}${url.search}${hash}`
      const id = url.searchParams.get('id') || hash.match(/[?&]id=(\d+)/)?.[1] || ''
      if (/playlist/i.test(combined) && id) return { type: 'playlist', id }
      if (/album/i.test(combined) && id) return { type: 'album', id }
      if (/song/i.test(combined) && id) return { type: 'song', id }
    } catch { /* fall through */ }
    return { type: 'home' }
  }
  return input
}

async function bridgeOpenHidden(ref: NeteaseRef): Promise<boolean> {
  const bridge = window.suqDesktop
  if (!bridge?.neteaseOpen) return false
  await bridge.neteaseOpen({ url: neteaseUrlFor(ref) })
  return true
}

async function bridgeClose(): Promise<void> {
  await window.suqDesktop?.neteaseClose?.()
}

async function bridgePause(): Promise<void> {
  try {
    await window.suqDesktop?.neteasePause?.()
  } catch { /* ignore */ }
}

function readLoginHostBounds(): NeteaseBounds | undefined {
  if (!loginHostEl) return undefined
  const rect = loginHostEl.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 40) return undefined
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

async function ensurePanelReady(): Promise<void> {
  if (!getOpen()) {
    useNeteaseStore.setState({ open: true })
    await bridgeOpenHidden({ type: 'home' })
  }
}

function getOpen(): boolean {
  return useNeteaseStore.getState().open
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollBusy = false

function stopPlaybackPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function ensurePlaybackPoll(): void {
  if (pollTimer || !window.suqDesktop?.neteasePlaybackState) return
  pollTimer = setInterval(() => {
    if (pollBusy) return
    pollBusy = true
    void useNeteaseStore
      .getState()
      .pollPlayback()
      .finally(() => {
        pollBusy = false
      })
  }, 400)
}

export const useNeteaseStore = create<NeteaseState>((set, get) => ({
  open: false,
  target: { type: 'home' },
  playlists: [],
  playlistsLoading: false,
  playlistsError: null,
  selectedPlaylistId: null,
  liked: null,
  likedLoading: false,
  likedError: null,
  searchQuery: '',
  searchResults: null,
  searchLoading: false,
  searchError: null,
  loginVisible: false,
  loggedIn: null,
  activeSongId: null,
  externalPlaying: false,
  externalTime: 0,
  externalDuration: 0,
  externalProgress: 0,
  setOpen: (open) => {
    set({ open })
    if (!open) {
      void bridgeClose()
      stopPlaybackPoll()
      set({ externalPlaying: false, externalTime: 0, externalDuration: 0, externalProgress: 0 })
    }
  },
  setTarget: (target) => set({ target }),
  openPanel: async (ref, opts) => {
    const target = toRef(ref)
    if (target.type === 'song' && target.id) {
      await get().playSong(target.id)
      return
    }
    if (!opts?.keepLocal) {
      usePlayerStore.getState().stop()
    }
    const wasOpen = get().open
    set({ open: true, target })
    try {
      const ok = await bridgeOpenHidden(target)
      if (!ok) {
        set({ open: false })
        window.open(neteaseUrlFor(target), '_blank', 'noopener,noreferrer')
        toast('已在浏览器打开网易云', 'info')
        return
      }
      await window.suqDesktop?.neteaseHideBrowser?.()
      set({ loginVisible: false })
      if (!wasOpen) {
        setTimeout(() => {
          void get().checkLogin()
          void get().refreshPlaylists()
        }, 300)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/ERR_ABORTED|aborted/i.test(message)) {
        set({ loginVisible: false })
        if (!wasOpen) {
          setTimeout(() => {
            void get().checkLogin()
            void get().refreshPlaylists()
          }, 400)
        }
        return
      }
      set({ open: false })
      toast(message || '打开网易云失败', 'error')
    }
  },
  closePanel: () => {
    set({ open: false, loginVisible: false, externalPlaying: false, externalTime: 0, externalDuration: 0, externalProgress: 0 })
    stopPlaybackPoll()
    void bridgeClose()
  },
  syncLayout: () => { /* 列表模式不依赖 webview 布局 */ },
  pauseExternal: () => {
    if (!get().open) return
    void bridgePause()
  },
  refreshPlaylists: async () => {
    const bridge = window.suqDesktop
    if (!bridge?.neteaseFetchPlaylists) {
      set({ playlistsError: '当前环境不支持读取歌单' })
      return
    }
    if (get().playlistsLoading) return
    set({ playlistsLoading: true, playlistsError: null })
    try {
      await ensurePanelReady()
      const result = await bridge.neteaseFetchPlaylists()
      if (result && result.ok) {
        const playlists = result.playlists
        const prev = get().selectedPlaylistId
        const still = prev && playlists.some((p) => p.id === prev) ? prev : (playlists[0]?.id ?? null)
        set({ playlists, loggedIn: true, selectedPlaylistId: still })
        if (still) await get().selectPlaylist(still)
        else set({ liked: null, likedError: '未读取到任何歌单' })
      } else {
        const message = result && 'message' in result ? result.message : '拉取失败'
        const stage = result && 'stage' in result ? result.stage : ''
        set({
          playlistsError:
            stage === 'login'
              ? '尚未登录，请点右上角「登录」完成后再刷新'
              : (message || '拉取歌单失败'),
        })
        if (stage === 'login') set({ loggedIn: false })
      }
    } catch (error) {
      set({ playlistsError: error instanceof Error ? error.message : '拉取歌单失败' })
    } finally {
      set({ playlistsLoading: false })
    }
  },
  refreshLiked: async () => {
    await get().refreshPlaylists()
  },
  selectPlaylist: async (playlistId) => {
    const bridge = window.suqDesktop
    if (!bridge?.neteaseFetchPlaylistSongs) {
      set({ likedError: '当前环境不支持读取歌单歌曲' })
      return
    }
    if (!playlistId) return
    set({ selectedPlaylistId: playlistId, likedLoading: true, likedError: null, liked: null })
    try {
      await ensurePanelReady()
      const result = await bridge.neteaseFetchPlaylistSongs(playlistId)
      if (result && result.ok) {
        const meta = get().playlists.find((p) => p.id === playlistId)
        set({
          liked: {
            playlistId: result.playlistId,
            playlistName: result.playlistName || meta?.name || '歌单',
            songs: result.songs,
            updatedAt: Date.now(),
          },
          likedError: result.songs.length ? null : '歌单为空',
        })
      } else {
        const message = result && 'message' in result ? result.message : '拉取失败'
        set({ liked: null, likedError: message || '拉取歌曲失败' })
      }
    } catch (error) {
      set({ liked: null, likedError: error instanceof Error ? error.message : '拉取歌曲失败' })
    } finally {
      set({ likedLoading: false })
    }
  },
  playLikedSong: (id) => {
    if (!id) return
    void get().playSong(id)
  },
  playSong: async (songId) => {
    const id = String(songId || '').trim()
    if (!/^\d+$/.test(id)) {
      toast('无效的网易云歌曲 id', 'error')
      return
    }
    usePlayerStore.getState().stop()
    const target: NeteaseRef = { type: 'song', id }
    set({
      open: true,
      target,
      loginVisible: false,
      activeSongId: id,
      externalPlaying: false,
      externalTime: 0,
      externalDuration: 0,
      externalProgress: 0,
    })
    ensurePlaybackPoll()
    try {
      const play = window.suqDesktop?.neteasePlaySong
      if (!play) {
        if (window.suqDesktop?.neteaseOpen) {
          await window.suqDesktop.neteaseOpen({ url: neteaseUrlFor(target) })
          await window.suqDesktop.neteaseHideBrowser?.()
          await window.suqDesktop.neteaseTryPlay?.()
          void get().pollPlayback()
        } else {
          window.open(neteaseUrlFor(target), '_blank', 'noopener,noreferrer')
          toast('已在浏览器打开网易云', 'info')
        }
        return
      }
      const result = await play(id)
      await window.suqDesktop?.neteaseHideBrowser?.()
      // 即便 timeout 也把 activeSongId 钉在目标 id，进度条与暂停钮可用
      if (result?.actualId) {
        set({ activeSongId: result.actualId })
      } else {
        set({ activeSongId: id })
      }
      void get().pollPlayback()
      if (!result?.ok) {
        // 路由成功但未起播：不弹刺眼错误，节点上可再点「播放」
        if (result?.stage === 'timeout' && result.actualId === id) {
          toast('已打开歌曲，未能自动起播，再点一次播放', 'info')
        } else {
          toast(result?.message || '网易云起播失败，请重试', 'error')
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ activeSongId: id })
      ensurePlaybackPoll()
      if (/ERR_ABORTED|aborted/i.test(message)) {
        try {
          const retry = await window.suqDesktop?.neteasePlaySong?.(id)
          if (retry && !retry.ok && retry.stage !== 'timeout') {
            toast(retry.message || '网易云起播失败', 'error')
          }
          void get().pollPlayback()
        } catch { /* ignore */ }
        return
      }
      toast(message || '网易云起播失败', 'error')
    }
  },
  pollPlayback: async () => {
    const bridge = window.suqDesktop
    if (!bridge?.neteasePlaybackState) return false
    try {
      const s = await bridge.neteasePlaybackState()
      if (!s) return false
      // 页内已切到其它 song 时跟随页内 id（避免进度画错节点）
      const active = s.songId || get().activeSongId
      set({
        activeSongId: active || null,
        externalPlaying: Boolean(s.playing),
        externalTime: Number(s.time) || 0,
        externalDuration: Number(s.duration) || 0,
        externalProgress: Number(s.progress) || 0,
      })
      if (s.playing) ensurePlaybackPoll()
      return true
    } catch {
      return false
    }
  },
  toggleSong: async (songId) => {
    const id = String(songId || '').trim()
    if (!/^\d+$/.test(id)) return
    const state = get()
    const isCurrent = state.activeSongId === id
    if (isCurrent) {
      const bridge = window.suqDesktop
      if (bridge?.neteaseToggle) {
        const r = await bridge.neteaseToggle()
        set({ externalPlaying: Boolean(r?.playing) })
        if (!r?.ok) toast(r?.message || '网易云未能起播，请重试', 'info')
        void get().pollPlayback()
        return
      }
      if (state.externalPlaying) {
        await bridge?.neteasePause?.()
        set({ externalPlaying: false })
        return
      }
      await bridge?.neteaseTryPlay?.()
      void get().pollPlayback()
      return
    }
    await get().playSong(id)
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  clearSearch: () => set({ searchQuery: '', searchResults: null, searchError: null }),
  runSearch: async () => {
    const q = get().searchQuery.trim()
    const bridge = window.suqDesktop
    if (!bridge?.neteaseSearch) {
      set({ searchError: '当前环境不支持搜索' })
      return
    }
    if (!q) {
      set({ searchResults: null, searchError: null })
      return
    }
    set({ searchLoading: true, searchError: null })
    try {
      await ensurePanelReady()
      const result = await bridge.neteaseSearch(q)
      if (result && result.ok) {
        set({ searchResults: result.songs, searchError: null })
        if (!result.songs.length) set({ searchError: '没有找到相关歌曲' })
      } else {
        set({
          searchError: (result && 'message' in result && result.message) || '搜索失败',
          searchResults: null,
        })
      }
    } catch (error) {
      set({ searchError: error instanceof Error ? error.message : '搜索失败' })
    } finally {
      set({ searchLoading: false })
    }
  },
  showLogin: async () => {
    const bridge = window.suqDesktop
    if (!bridge?.neteaseShowBrowser) {
      toast('当前环境不支持登录页', 'error')
      return
    }
    await ensurePanelReady()
    set({ loginVisible: true })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))
    await new Promise((resolve) => setTimeout(resolve, 180))
    await bridge.neteaseShowBrowser(readLoginHostBounds())
    await new Promise((resolve) => setTimeout(resolve, 120))
    await bridge.neteaseShowBrowser(readLoginHostBounds())
  },
  hideLogin: async () => {
    set({ loginVisible: false })
    await window.suqDesktop?.neteaseHideBrowser?.()
    void get().checkLogin()
    void get().refreshPlaylists()
  },
  checkLogin: async () => {
    const bridge = window.suqDesktop
    if (!bridge?.neteaseLoggedIn) return
    try {
      await ensurePanelReady()
      const ok = await bridge.neteaseLoggedIn()
      set({ loggedIn: ok })
    } catch {
      set({ loggedIn: null })
    }
  },
}))

let loginHostEl: HTMLElement | null = null

export function registerNeteaseLoginHost(el: HTMLElement | null): void {
  loginHostEl = el
}

export function pauseNeteaseForLocalPlayback(): void {
  if (!useNeteaseStore.getState().open) return
  useNeteaseStore.getState().pauseExternal()
}

setExternalSourcePauseHook(pauseNeteaseForLocalPlayback)
