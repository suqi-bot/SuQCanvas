import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_EDGE_STYLE, type SuqEdge, type SuqNode } from '../types'
import { useCanvasStore } from './canvasStore'
import { pauseNeteaseForLocalPlayback, useNeteaseStore } from './neteaseStore'

afterEach(() => {
  useNeteaseStore.getState().setOpen(false)
  useNeteaseStore.setState({ liked: null, searchResults: null })
  useCanvasStore.getState().reset()
  vi.unstubAllGlobals()
})

test('网易云节点沿画布连线切歌，当前曲自然结束时续播下一节点', async () => {
  const nodes: SuqNode[] = ['1', '2', '3'].map((id) => ({
    id: `n${id}`, type: 'netease', position: { x: 0, y: 0 },
    data: { kind: 'netease', neteaseId: id, label: `歌曲 ${id}` },
  }))
  const edges: SuqEdge[] = [
    { id: 'e1', source: 'n1', target: 'n2', type: 'styled', data: { style: { ...DEFAULT_EDGE_STYLE } } },
    { id: 'e2', source: 'n2', target: 'n3', type: 'styled', data: { style: { ...DEFAULT_EDGE_STYLE } } },
  ]
  useCanvasStore.setState({ nodes, edges })
  const play = vi.fn(async (id: string) => ({ ok: true, actualId: id }))
  let playback = { songId: '1', playing: true, ended: false, time: 98, duration: 100, progress: 0.98, hash: '' }
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: play,
      neteasePlaybackState: async () => playback,
      neteaseClose: () => undefined,
    },
  })

  await useNeteaseStore.getState().toggleSong('1', '歌曲 1', 'n1')
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState().playQueue.map((song) => song.id)).toEqual(['1', '2', '3'])
  expect(useNeteaseStore.getState().queueSource).toBe('flow')

  useNeteaseStore.getState().closePanel()
  expect(useNeteaseStore.getState()).toMatchObject({ open: true, panelVisible: false, activeSongId: '1' })
  playback = { songId: '1', playing: false, ended: true, time: 100, duration: 100, progress: 1, hash: '' }
  await useNeteaseStore.getState().pollPlayback()
  expect(play.mock.calls.map(([id]) => id)).toEqual(['1', '2'])
  expect(useNeteaseStore.getState().activeSongId).toBe('2')
  expect(useNeteaseStore.getState().queueSource).toBe('flow')
  expect(useNeteaseStore.getState().panelVisible).toBe(false)
})

test('网易云点歌显示悬浮窗，隐藏后可恢复，切回本地播放时隐藏', async () => {
  const pause = vi.fn(async () => true)
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: async () => ({ ok: true, actualId: '123' }),
      neteasePause: pause,
      neteaseClose: () => undefined,
    },
  })

  await useNeteaseStore.getState().playSong('123', '测试歌曲')
  expect(useNeteaseStore.getState()).toMatchObject({
    open: true,
    activeSongId: '123',
    activeSongName: '测试歌曲',
    floatingVisible: true,
  })

  useNeteaseStore.getState().setFloatingVisible(false)
  expect(useNeteaseStore.getState().floatingVisible).toBe(false)
  useNeteaseStore.getState().setFloatingVisible(true)
  expect(useNeteaseStore.getState().floatingVisible).toBe(true)

  pauseNeteaseForLocalPlayback()
  expect(pause).toHaveBeenCalledOnce()
  expect(useNeteaseStore.getState().floatingVisible).toBe(false)

  useNeteaseStore.getState().closePanel()
  expect(useNeteaseStore.getState()).toMatchObject({
    open: true,
    panelVisible: false,
    activeSongId: '123',
    floatingVisible: false,
  })
})

test('关闭网易云侧栏保留播放和悬浮窗，重新打开不重播歌曲', async () => {
  const play = vi.fn(async (id: string) => ({ ok: true, actualId: id }))
  const close = vi.fn()
  const hideBrowser = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: play,
      neteasePlaybackState: async () => ({ songId: '123', playing: true, ended: false, time: 45, duration: 180, progress: 0.25, hash: '' }),
      neteaseHideBrowser: hideBrowser,
      neteaseClose: close,
    },
  })

  await useNeteaseStore.getState().playSong('123', '测试歌曲')
  await useNeteaseStore.getState().pollPlayback()
  useNeteaseStore.getState().closePanel()
  expect(useNeteaseStore.getState()).toMatchObject({
    open: true, panelVisible: false, activeSongId: '123',
    externalPlaying: true, externalTime: 45, floatingVisible: true,
  })
  expect(close).not.toHaveBeenCalled()
  expect(hideBrowser).toHaveBeenCalled()

  await useNeteaseStore.getState().openPanel()
  expect(useNeteaseStore.getState().panelVisible).toBe(true)
  expect(play).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
})

test('悬浮窗按当前列表切换上下首，并按绝对时间调整进度', async () => {
  const play = vi.fn(async (id: string) => ({ ok: true, actualId: id }))
  const seek = vi.fn(async (time: number) => ({ ok: true, time }))
  vi.stubGlobal('window', {
    suqDesktop: { neteasePlaySong: play, neteaseSeekTo: seek, neteaseClose: () => undefined },
  })
  const songs = [
    { id: '1', name: '第一首' },
    { id: '2', name: '第二首' },
    { id: '3', name: '第三首' },
  ]

  await useNeteaseStore.getState().playSong('2', '第二首', songs)
  await useNeteaseStore.getState().previousSong()
  expect(useNeteaseStore.getState().activeSongId).toBe('1')
  await useNeteaseStore.getState().previousSong()
  expect(useNeteaseStore.getState().activeSongId).toBe('3')

  await useNeteaseStore.getState().nextSong()
  await useNeteaseStore.getState().nextSong()
  await useNeteaseStore.getState().nextSong()
  expect(play.mock.calls.map(([id]) => id)).toEqual(['2', '1', '3', '1', '2', '3'])
  expect(useNeteaseStore.getState().activeSongName).toBe('第三首')

  useNeteaseStore.setState({ externalDuration: 180, externalTime: 20 })
  await useNeteaseStore.getState().seekTo(72)
  expect(seek).toHaveBeenCalledWith(72)
  expect(useNeteaseStore.getState().externalTime).toBe(72)
  await useNeteaseStore.getState().seekTo(999)
  expect(seek).toHaveBeenLastCalledWith(180)
})

test('网易云拖动时保持目标进度，网页跳转失败时恢复实际进度', async () => {
  let finishSeek!: (result: { ok: boolean; time?: number }) => void
  const seek = vi.fn(() => new Promise<{ ok: boolean; time?: number }>((resolve) => { finishSeek = resolve }))
  let playbackTime = 20
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: async () => ({ ok: true, actualId: '1' }),
      neteasePlaybackState: async () => ({ songId: '1', playing: true, ended: false, time: playbackTime, duration: 180, progress: playbackTime / 180, hash: '' }),
      neteaseSeekTo: seek,
      neteaseClose: () => undefined,
    },
  })
  await useNeteaseStore.getState().playSong('1', '测试歌曲')
  await useNeteaseStore.getState().pollPlayback()

  const pending = useNeteaseStore.getState().seekTo(72)
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState().externalTime).toBe(72)

  finishSeek({ ok: true, time: 72 })
  await pending
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState().externalTime).toBe(72)

  playbackTime = 72
  await useNeteaseStore.getState().pollPlayback()
  playbackTime = 73
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState().externalTime).toBe(73)

  const failed = useNeteaseStore.getState().seekTo(100)
  finishSeek({ ok: false, time: 73 })
  await failed
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState().externalTime).toBe(73)
})

test('连线歌曲拖到结尾后网页切歌时继续按连线顺序播放', async () => {
  const nodes: SuqNode[] = ['1', '2'].map((id) => ({
    id: `n${id}`, type: 'netease', position: { x: 0, y: 0 },
    data: { kind: 'netease', neteaseId: id, label: `歌曲 ${id}` },
  }))
  useCanvasStore.setState({
    nodes,
    edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'styled', data: { style: { ...DEFAULT_EDGE_STYLE } } }],
  })
  const play = vi.fn(async (id: string) => ({ ok: true, actualId: id }))
  let songId = '1'
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: play,
      neteaseSeekTo: async () => ({ ok: true, time: 100 }),
      neteasePlaybackState: async () => ({ songId, playing: true, ended: false, time: songId === '1' ? 98 : 0, duration: 100, progress: 0, hash: '' }),
      neteaseClose: () => undefined,
    },
  })
  await useNeteaseStore.getState().toggleSong('1', '歌曲 1', 'n1')
  await useNeteaseStore.getState().pollPlayback()
  await useNeteaseStore.getState().seekTo(100)
  songId = '2'
  await useNeteaseStore.getState().pollPlayback()
  expect(play.mock.calls.map(([id]) => id)).toEqual(['1'])
  expect(useNeteaseStore.getState().activeSongId).toBe('2')
  expect(useNeteaseStore.getState().queueSource).toBe('flow')
})

test('网易云连线最后一首结束后停止并拦住网页自动续播', async () => {
  const nodes: SuqNode[] = ['1', '2'].map((id) => ({
    id: `n${id}`, type: 'netease', position: { x: 0, y: 0 },
    data: { kind: 'netease', neteaseId: id, label: `歌曲 ${id}` },
  }))
  useCanvasStore.setState({
    nodes,
    edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'styled', data: { style: { ...DEFAULT_EDGE_STYLE } } }],
  })
  let siteSongId = '1'
  const play = vi.fn(async (id: string) => { siteSongId = id; return { ok: true, actualId: id } })
  const pause = vi.fn(async () => true)
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: play,
      neteasePause: pause,
      neteasePlaybackState: async () => ({ songId: siteSongId, playing: true, ended: false, time: siteSongId === '2' ? 95 : 0, duration: 100, progress: 0, hash: '' }),
      neteaseClose: () => undefined,
    },
  })
  await useNeteaseStore.getState().toggleSong('1', '歌曲 1', 'n1')
  await useNeteaseStore.getState().nextSong()
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState()).toMatchObject({ activeSongId: '2', externalPlaying: true, externalTime: 95 })
  await useNeteaseStore.getState().nextSong()
  expect(play.mock.calls.map(([id]) => id)).toEqual(['1', '2'])

  siteSongId = '999'
  await useNeteaseStore.getState().pollPlayback()
  expect(pause).toHaveBeenCalledOnce()
  expect(useNeteaseStore.getState()).toMatchObject({ activeSongId: '2', externalPlaying: false, externalTime: 100, externalProgress: 1 })
  await useNeteaseStore.getState().pollPlayback()
  expect(pause).toHaveBeenCalledTimes(2)
  expect(useNeteaseStore.getState().activeSongId).toBe('2')

  await useNeteaseStore.getState().toggleSong('2')
  expect(play.mock.calls.map(([id]) => id)).toEqual(['1', '2', '2'])
  expect(useNeteaseStore.getState().activeSongId).toBe('2')
})

test('网易云连线单曲自然结束时保持在末曲并显示停止', async () => {
  useCanvasStore.setState({
    nodes: [{ id: 'n1', type: 'netease', position: { x: 0, y: 0 }, data: { kind: 'netease', neteaseId: '1', label: '歌曲 1' } }],
    edges: [],
  })
  let ended = false
  const play = vi.fn(async () => ({ ok: true, actualId: '1' }))
  const pause = vi.fn(async () => true)
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: play,
      neteasePause: pause,
      neteasePlaybackState: async () => ({ songId: '1', playing: !ended, ended, time: ended ? 100 : 95, duration: 100, progress: 1, hash: '' }),
      neteaseClose: () => undefined,
    },
  })
  await useNeteaseStore.getState().toggleSong('1', '歌曲 1', 'n1')
  await useNeteaseStore.getState().pollPlayback()
  ended = true
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState()).toMatchObject({ activeSongId: '1', externalPlaying: false, externalTime: 100, externalProgress: 1 })
  expect(play).toHaveBeenCalledOnce()
  expect(pause).toHaveBeenCalledOnce()
})

test('从搜索结果点歌沿搜索结果切歌，加载期间忽略上一首的网页状态', async () => {
  let finishPlay!: (result: { ok: boolean; actualId: string }) => void
  const play = vi.fn(() => new Promise<{ ok: boolean; actualId: string }>((resolve) => { finishPlay = resolve }))
  vi.stubGlobal('window', {
    suqDesktop: {
      neteasePlaySong: play,
      neteasePlaybackState: async () => ({ songId: '1', playing: true, time: 90, duration: 180, progress: 0.5, hash: '' }),
      neteaseClose: () => undefined,
    },
  })
  useNeteaseStore.setState({
    liked: { playlistId: 'p', playlistName: '歌单', songs: [{ id: '2', name: '歌单版本' }], updatedAt: 0 },
    searchResults: [{ id: '2', name: '搜索版本' }, { id: '3', name: '下一首' }],
  })

  const pending = useNeteaseStore.getState().playLikedSong('2', 'search')
  expect(useNeteaseStore.getState().playQueue.map((song) => song.id)).toEqual(['2', '3'])
  expect(useNeteaseStore.getState().activeSongName).toBe('搜索版本')
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState().activeSongId).toBe('2')

  finishPlay({ ok: true, actualId: '2' })
  await pending
  await useNeteaseStore.getState().pollPlayback()
  expect(useNeteaseStore.getState().activeSongId).toBe('2')
})
