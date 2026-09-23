import { create } from 'zustand'
import { neteaseUrlFor, type NeteaseRef } from '../media/netease'
import { linearizeNeteaseFrom } from '../media/neteaseFlow'
import { useCanvasStore } from './canvasStore'
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
  /** 网易云播放容器是否仍在运行 */
  open: boolean
  setOpen: (open: boolean) => void
  /** 侧栏可见性，独立于播放容器 */
  panelVisible: boolean
  showPanel: () => void
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
  playLikedSong: (id: string, source: 'playlist' | 'search') => Promise<void>
  /** 画布/列表点播指定歌曲（专用链路，避免误点第一首） */
  playSong: (songId: string, name?: string, queue?: NeteaseLikedSong[], source?: 'list' | 'flow') => Promise<void>
  /** 网易云侧当前曲（画布节点用来显示进度/暂停） */
  activeSongId: string | null
  activeSongName: string
  playQueue: NeteaseLikedSong[]
  queueSource: 'list' | 'flow'
  previousSong: () => Promise<void>
  nextSong: () => Promise<void>
  useNodeFlow: (nodeId: string, songId: string) => void
  floatingVisible: boolean
  setFloatingVisible: (visible: boolean) => void
  externalPlaying: boolean
  externalTime: number
  externalDuration: number
  externalProgress: number
  /** 读一次页内状态并写入 store；返回是否成功 */
  pollPlayback: () => Promise<boolean>
  /** 同一首：暂停/继续；否则当播放 */
  toggleSong: (songId: string, name?: string, nodeId?: string) => Promise<void>
  seekTo: (time: number) => Promise<void>
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

function songNameFor(id: string, state: NeteaseState): string {
  return state.liked?.songs.find((song) => song.id === id)?.name
    ?? state.searchResults?.find((song) => song.id === id)?.name
    ?? `网易云歌曲 ${id}`
}

function queueForSong(id: string, state: NeteaseState): NeteaseLikedSong[] {
  if (state.liked?.songs.some((song) => song.id === id)) return state.liked.songs
  if (state.searchResults?.some((song) => song.id === id)) return state.searchResults
  return [{ id, name: songNameFor(id, state) }]
}

function queueForNode(nodeId: string, songId: string): NeteaseLikedSong[] | null {
  const { nodes, edges } = useCanvasStore.getState()
  const tracks = linearizeNeteaseFrom(nodes, edges, nodeId)
  if (tracks[0]?.id !== songId) return null
  const byNodeId = new Map(nodes.map((node) => [node.id, node]))
  return tracks.map(({ nodeId: trackNodeId, id, name }) => ({
    id,
    name,
    coverUrl: byNodeId.get(trackNodeId)?.data.neteaseCoverUrl,
  }))
}

function hasPlaybackBridge(): boolean {
  return Boolean(window.suqDesktop?.neteasePlaySong || window.suqDesktop?.neteaseOpen)
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
let playRequestSeq = 0
let playInFlightId: string | null = null
let expectedSongId: string | null = null
let expectedSongUntil = 0
let seekRequestSeq = 0
let pendingSeek: { songId: string; time: number; until: number } | null = null
let stoppedAtFlowEnd: string | null = null

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
  panelVisible: false,
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
  activeSongName: '',
  playQueue: [],
  queueSource: 'list',
  floatingVisible: false,
  externalPlaying: false,
  externalTime: 0,
  externalDuration: 0,
  externalProgress: 0,
  setFloatingVisible: (floatingVisible) => set({ floatingVisible }),
  showPanel: () => set({ panelVisible: true }),
  setOpen: (open) => {
    set({ open, ...(!open ? { panelVisible: false, loginVisible: false } : {}) })
    if (!open) {
      playRequestSeq += 1
      seekRequestSeq += 1
      pendingSeek = null
      stoppedAtFlowEnd = null
      playInFlightId = null
      expectedSongId = null
      void bridgeClose()
      stopPlaybackPoll()
      set({ activeSongId: null, activeSongName: '', playQueue: [], queueSource: 'list', floatingVisible: false, externalPlaying: false, externalTime: 0, externalDuration: 0, externalProgress: 0 })
    }
  },
  setTarget: (target) => set({ target }),
  openPanel: async (ref, opts) => {
    const target = toRef(ref)
    if (target.type === 'song' && target.id) {
      set({ panelVisible: true })
      await get().playSong(target.id)
      return
    }
    if (get().open && target.type === 'home') {
      set({ panelVisible: true })
      return
    }
    if (!opts?.keepLocal) {
      usePlayerStore.getState().stop()
    }
    const wasOpen = get().open
    set({ open: true, panelVisible: true, target })
    try {
      const ok = await bridgeOpenHidden(target)
      if (!ok) {
        set({ open: false, panelVisible: false })
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
      set({ open: false, panelVisible: false })
      toast(message || '打开网易云失败', 'error')
    }
  },
  closePanel: () => {
    set({ panelVisible: false, loginVisible: false })
    void window.suqDesktop?.neteaseHideBrowser?.()
  },
  syncLayout: () => { /* 列表模式不依赖 webview 布局 */ },
  pauseExternal: () => {
    if (!get().open) return
    set({ externalPlaying: false, floatingVisible: false })
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
  playLikedSong: async (id, source) => {
    if (!id) return
    const queue = source === 'search' ? get().searchResults : get().liked?.songs
    await get().playSong(id, queue?.find((song) => song.id === id)?.name, queue ?? undefined)
  },
  playSong: async (songId, name, queue, source = 'list') => {
    const id = String(songId || '').trim()
    if (!/^\d+$/.test(id)) {
      toast('无效的网易云歌曲 id', 'error')
      return
    }
    usePlayerStore.getState().stop()
    const requestSeq = ++playRequestSeq
    seekRequestSeq += 1
    pendingSeek = null
    stoppedAtFlowEnd = null
    playInFlightId = id
    expectedSongId = null
    const target: NeteaseRef = { type: 'song', id }
    const playQueue = queue?.some((song) => song.id === id) ? queue : queueForSong(id, get())
    set({
      open: true,
      panelVisible: get().open ? get().panelVisible : true,
      target,
      loginVisible: false,
      activeSongId: id,
      activeSongName: name || playQueue.find((song) => song.id === id)?.name || songNameFor(id, get()),
      playQueue,
      queueSource: source,
      floatingVisible: hasPlaybackBridge(),
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
      if (requestSeq !== playRequestSeq || !get().open) return
      await window.suqDesktop?.neteaseHideBrowser?.()
      // 即便 timeout 也把 activeSongId 钉在目标 id，进度条与暂停钮可用
      if (result?.actualId) {
        set({
          activeSongId: result.actualId,
          ...(result.actualId !== id ? { activeSongName: songNameFor(result.actualId, get()) } : {}),
        })
      } else {
        set({ activeSongId: id })
      }
      if (result?.actualId === id || (result?.ok && !result.actualId)) {
        expectedSongId = id
        expectedSongUntil = Date.now() + 3000
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
      if (requestSeq !== playRequestSeq || !get().open) return
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
    } finally {
      if (requestSeq === playRequestSeq) {
        playInFlightId = null
        void get().pollPlayback()
      }
    }
  },
  pollPlayback: async () => {
    const bridge = window.suqDesktop
    if (!get().open || !bridge?.neteasePlaybackState) return false
    try {
      const s = await bridge.neteasePlaybackState()
      if (!s || !get().open) return false
      if (stoppedAtFlowEnd && get().queueSource === 'flow' && get().activeSongId === stoppedAtFlowEnd) {
        // 网页播放器可能自行播放下一首；连线已到末尾后持续保持停止状态。
        if (s.playing) await bridgePause()
        const duration = get().externalDuration
        set({ externalPlaying: false, externalTime: duration, externalProgress: duration > 0 ? 1 : 0 })
        return true
      }
      if (playInFlightId && s.songId !== playInFlightId) return false
      if (expectedSongId) {
        const atFlowEnd = get().queueSource === 'flow' && get().externalDuration > 0 &&
          get().externalTime >= get().externalDuration - 1.5
        if (s.songId === expectedSongId || Date.now() >= expectedSongUntil || atFlowEnd) expectedSongId = null
        else return false
      }
      const previous = get()
      const seeking = pendingSeek?.songId === previous.activeSongId && Date.now() < pendingSeek.until
      const siteAdvanced = Boolean(s.songId) && s.songId !== previous.activeSongId
      const reachedFlowEnd = previous.queueSource === 'flow' && previous.externalPlaying && previous.activeSongId && (
        (!seeking && (!s.songId || s.songId === previous.activeSongId) && Boolean(s.ended)) ||
        siteAdvanced
      )
      if (reachedFlowEnd) {
        const index = previous.playQueue.findIndex((song) => song.id === previous.activeSongId)
        const next = index >= 0 ? previous.playQueue[index + 1] : undefined
        if (next) {
          if (siteAdvanced && s.songId === next.id && s.playing) {
            pendingSeek = null
            const duration = Number(s.duration) || 0
            const time = Number(s.time) || 0
            set({ activeSongId: next.id, activeSongName: next.name, externalPlaying: true, externalTime: time, externalDuration: duration, externalProgress: duration > 0 ? Math.min(1, time / duration) : 0 })
            return true
          }
          await get().playSong(next.id, next.name, previous.playQueue, 'flow')
          return true
        }
        stoppedAtFlowEnd = previous.activeSongId
        await bridgePause()
        if (get().activeSongId !== previous.activeSongId || get().queueSource !== 'flow') return true
        const duration = previous.externalDuration || Number(s.duration) || 0
        set({ externalPlaying: false, externalTime: duration, externalDuration: duration, externalProgress: duration > 0 ? 1 : 0 })
        return true
      }
      // 页内已切到其它 song 时跟随页内 id（避免进度画错节点）
      const active = s.songId || get().activeSongId
      if (pendingSeek && (pendingSeek.songId !== active || Date.now() >= pendingSeek.until || Math.abs((Number(s.time) || 0) - pendingSeek.time) <= 1)) {
        pendingSeek = null
      }
      const displayedTime = pendingSeek?.songId === active ? pendingSeek.time : (Number(s.time) || 0)
      const displayedDuration = Number(s.duration) || previous.externalDuration
      set({
        activeSongId: active || null,
        ...(active && active !== get().activeSongId ? { activeSongName: songNameFor(active, get()) } : {}),
        externalPlaying: Boolean(s.playing),
        externalTime: displayedTime,
        externalDuration: displayedDuration,
        externalProgress: displayedDuration > 0 ? Math.min(1, displayedTime / displayedDuration) : (Number(s.progress) || 0),
      })
      if (s.playing) ensurePlaybackPoll()
      return true
    } catch {
      return false
    }
  },
  toggleSong: async (songId, name, nodeId) => {
    const id = String(songId || '').trim()
    if (!/^\d+$/.test(id)) return
    const state = get()
    const isCurrent = state.activeSongId === id
    const flowQueue = nodeId ? queueForNode(nodeId, id) : null
    if (isCurrent) {
      if (stoppedAtFlowEnd === id) {
        stoppedAtFlowEnd = null
        await get().playSong(id, name || state.activeSongName, state.playQueue, state.queueSource)
        return
      }
      set({
        floatingVisible: hasPlaybackBridge(),
        ...(name ? { activeSongName: name } : {}),
        ...(flowQueue ? { playQueue: flowQueue, queueSource: 'flow' as const } : {}),
      })
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
    await get().playSong(id, name, flowQueue ?? undefined, flowQueue ? 'flow' : 'list')
  },
  previousSong: async () => {
    const { activeSongId, playQueue, queueSource } = get()
    const index = playQueue.findIndex((song) => song.id === activeSongId)
    if (playQueue.length < 2 || index < 0) return
    if (queueSource === 'flow' && index === 0) return
    const song = playQueue[(index - 1 + playQueue.length) % playQueue.length]
    await get().playSong(song.id, song.name, playQueue, queueSource)
  },
  nextSong: async () => {
    const { activeSongId, playQueue, queueSource } = get()
    const index = playQueue.findIndex((song) => song.id === activeSongId)
    if (playQueue.length < 2 || index < 0) return
    if (queueSource === 'flow' && index === playQueue.length - 1) return
    const song = playQueue[(index + 1) % playQueue.length]
    await get().playSong(song.id, song.name, playQueue, queueSource)
  },
  useNodeFlow: (nodeId, songId) => {
    if (get().activeSongId !== songId) return
    const queue = queueForNode(nodeId, songId)
    if (queue) set({ playQueue: queue, queueSource: 'flow' })
  },
  seekTo: async (time) => {
    const { activeSongId, externalDuration } = get()
    const seek = window.suqDesktop?.neteaseSeekTo
    if (!get().open || !activeSongId || !seek || externalDuration <= 0 || !Number.isFinite(time)) return
    const next = Math.max(0, Math.min(time, externalDuration))
    const requestSeq = ++seekRequestSeq
    pendingSeek = { songId: activeSongId, time: next, until: Date.now() + 3000 }
    set({ externalTime: next, externalProgress: next / externalDuration })
    try {
      const result = await seek(next)
      if (requestSeq !== seekRequestSeq || get().activeSongId !== activeSongId) return
      if (!result?.ok) {
        pendingSeek = null
        toast('网易云未能调整播放进度，请重试', 'error')
      }
    } catch {
      if (requestSeq !== seekRequestSeq || get().activeSongId !== activeSongId) return
      pendingSeek = null
      toast('网易云未能调整播放进度，请重试', 'error')
    } finally {
      if (requestSeq === seekRequestSeq && get().activeSongId === activeSongId) void get().pollPlayback()
    }
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
