import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AudioIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CloseIcon,
  DownloadIcon,
  FlowIcon,
  HeartIcon,
  MoreIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  SearchIcon,
  SequentialIcon,
  ShuffleIcon,
  VolumeIcon,
} from '../canvas/nodes/Icons'
import { db } from '../db/db'
import { getAssetUrl, getThumbnailUrl } from '../media/blobRegistry'
import { loadLyricsFor, type LyricsData } from '../media/lyrics'
import { findPlaylistByAsset, linearizeFrom, resolvePlaylistsCached, type Playlist } from '../media/playlists'
import { isMp3, type ManagedFile } from '../media/managedFile'
import { useCoverPalette } from '../media/coverColor'
import { AudioBackground } from './AudioBackground'
import { useCanvasStore } from '../store/canvasStore'
import { setOrderProvider, usePlayerStore, type EngineTrack, type PlaybackMode } from '../store/playerStore'
import { toast } from '../store/uiStore'
import type { SuqNode } from '../types'

const LYRIC_OFFSET_KEY = 'suqcanvas:lyricOffsets'
const LIKED_KEY = 'suqcanvas:likedSongs'

function loadLyricOffset(assetId: string): number {
  try {
    const map = JSON.parse(localStorage.getItem(LYRIC_OFFSET_KEY) ?? '{}') as Record<string, number>
    return map[assetId] ?? 0
  } catch {
    return 0
  }
}

function saveLyricOffset(assetId: string, offset: number): void {
  try {
    const map = JSON.parse(localStorage.getItem(LYRIC_OFFSET_KEY) ?? '{}') as Record<string, number>
    if (offset === 0) delete map[assetId]
    else map[assetId] = offset
    localStorage.setItem(LYRIC_OFFSET_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

function loadLikedMap(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LIKED_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function saveLiked(assetId: string, liked: boolean): void {
  try {
    const map = loadLikedMap()
    if (liked) map[assetId] = true
    else delete map[assetId]
    localStorage.setItem(LIKED_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

const MODE_ORDER: PlaybackMode[] = ['sequential', 'loop', 'single', 'random', 'flow']

const MODE_LABELS: Record<PlaybackMode, string> = {
  sequential: '顺序播放',
  random: '随机播放',
  loop: '列表循环',
  single: '单曲循环',
  flow: '流式播放',
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function nameHue(name: string): number {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return hash
}

// 沿画布连线(音频节点之间的边)从起点节点深度优先先序遍历,得到歌单顺序。
// 与画布自动切歌共用 playlists 模块的同一套顺序规则(边序号 + DFS 先序)。
function buildFlowOrder(startAssetId: string): string[] {
  const { nodes, edges } = useCanvasStore.getState()
  const startNode = nodes.find(
    (node) => node.data.kind === 'audio' && node.data.assetId === startAssetId,
  )
  if (!startNode) return [startAssetId]
  return linearizeFrom(nodes, edges, startNode.id).assetIds
}

function ModeGlyph({ mode }: { mode: PlaybackMode }) {
  if (mode === 'random') return <ShuffleIcon />
  if (mode === 'single') return <RepeatOneIcon />
  if (mode === 'loop') return <RepeatIcon />
  if (mode === 'flow') return <FlowIcon />
  return <SequentialIcon />
}

export function AudioPlayerView({
  files,
  initialAssetId,
  initialFlow,
  initialPlaylistId,
  onBack,
  onClose,
}: {
  files: ManagedFile[]
  initialAssetId: string
  initialFlow: boolean
  initialPlaylistId?: string
  onBack: () => void
  onClose: () => void
}) {
  const mp3Files = useMemo(() => files.filter(isMp3), [files])
  const canvasNodes = useCanvasStore((s) => s.nodes)
  const canvasEdges = useCanvasStore((s) => s.edges)
  // 画布歌单:命名文本节点指向的音频链,顺序与画布连线一致(边序号 + DFS 先序)
  const playlists = useMemo(() => {
    const valid = new Set(mp3Files.map((file) => file.assetId))
    return resolvePlaylistsCached(canvasNodes, canvasEdges)
      .map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.filter((track) => valid.has(track.assetId)),
      }))
      .filter((playlist) => playlist.tracks.length > 0)
  }, [canvasNodes, canvasEdges, mp3Files])
  const [asideTab, setAsideTab] = useState<'songs' | 'playlists'>('songs')
  const [queueOpen, setQueueOpen] = useState(false)
  // 歌单标签页中展开预览的歌单 id（null = 全部收起）
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null)
  // 从画布歌单入口(文本节点徽标)进入时,挂载后把该歌单设为播放队列;
  // 播放器已打开时再次点击徽标(initialPlaylistId 变化)也重新设置队列
  const queueInitRef = useRef<string | null | undefined>(undefined)
  const [sort, setSort] = useState<'default' | 'title' | 'importer'>('default')
  const [flowOrder, setFlowOrder] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [lyricsSource, setLyricsSource] = useState<string>()
  const [lyricsState, setLyricsState] = useState<'loading' | 'ready' | 'none'>('loading')
  const [lyricOffset, setLyricOffset] = useState(0)
  const [albumUrls, setAlbumUrls] = useState<string[]>([])
  const [albumIndex, setAlbumIndex] = useState(0)
  const [liked, setLiked] = useState(false)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const mode = usePlayerStore((s) => s.mode)
  const queue = usePlayerStore((s) => s.queue)
  const track = usePlayerStore((s) => s.track)
  const playing = usePlayerStore((s) => s.playing)
  const currentTime = usePlayerStore((s) => s.time)
  const duration = usePlayerStore((s) => s.duration)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef(new Map<number, HTMLButtonElement>())
  const freezeUntilRef = useRef(0)

  const orderedFiles = useMemo(() => {
    const result = [...mp3Files]
    if (sort === 'title') result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    else if (sort === 'importer') result.sort((a, b) => (a.nodes[0]?.data.createdByName ?? '').localeCompare(b.nodes[0]?.data.createdByName ?? '', 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'))
    return result
  }, [mp3Files, sort])
  const visibleFiles = useMemo(() => {
    const keyword = query.normalize('NFKC').toLocaleLowerCase().trim()
    if (!keyword) return orderedFiles
    return orderedFiles.filter(
      (file) => file.name.toLocaleLowerCase().includes(keyword) || (file.nodes[0]?.data.createdByName ?? '').toLocaleLowerCase().includes(keyword),
    )
  }, [orderedFiles, query])
  // 当前曲目 = 引擎曲目；引擎尚未载入时以列表第一首作为展示占位
  const current = useMemo<EngineTrack | null>(() => {
    if (track) return track
    const first = orderedFiles[0]
    return first
      ? { assetId: first.assetId, name: first.name, url: '', nodeId: first.nodes[0]?.id }
      : null
  }, [track, orderedFiles])
  const currentFile = useMemo(
    () => (current ? mp3Files.find((file) => file.assetId === current.assetId) : undefined),
    [mp3Files, current],
  )
  // 供键盘快捷键读取最新曲目（避免空依赖闭包捕获过期 current）
  const currentRef = useRef<EngineTrack | null>(null)
  currentRef.current = current
  // 歌词/专辑图等按当前曲目读取画布节点信息（用 ref 避免画布编辑时触发重载）
  const currentNodesRef = useRef<SuqNode[]>([])
  currentNodesRef.current = currentFile?.nodes ?? []
  // 当前曲目所属的画布歌单(未处于该歌单队列时,在标题下显示入口)
  const currentPlaylist = useMemo(
    () => findPlaylistByAsset(playlists, current?.assetId),
    [playlists, current?.assetId],
  )
  // 播放器打开期间向引擎注册歌曲列表顺序(顺序/循环/随机模式的导航基准)
  useEffect(() => {
    setOrderProvider(() => orderedFiles.map((file) => file.assetId))
    return () => setOrderProvider(null)
  }, [orderedFiles])
  // 打开时恢复播放模式(与旧行为一致:歌单/画布入口=流式,其余=顺序)
  useEffect(() => {
    usePlayerStore.getState().setMode(initialFlow ? 'flow' : 'sequential')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 歌单徽标入口:设置队列并按歌单顺序起播
  useEffect(() => {
    if (queueInitRef.current === (initialPlaylistId ?? null)) return
    if (!initialPlaylistId) {
      queueInitRef.current = null
      return
    }
    const playlist = playlists.find((item) => item.id === initialPlaylistId)
    if (!playlist) return // 画布尚未解析出该歌单,playlists 变化后会重试
    queueInitRef.current = initialPlaylistId
    openPlaylist(playlist)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, initialPlaylistId])
  // 悬浮窗等入口在播放器已打开时切换到目标歌曲(歌单入口由上面的队列初始化接管)
  useEffect(() => {
    if (initialPlaylistId) return
    const player = usePlayerStore.getState()
    if (player.track?.assetId !== initialAssetId) {
      player.setQueue(null)
      player.play({ assetId: initialAssetId }, { autoplay: false })
    }
  }, [initialAssetId, initialPlaylistId])
  const totalOffset = (lyrics?.offsetMs ?? 0) / 1000 + lyricOffset
  const progress = duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0
  const coverUrl = albumUrls.length > 0 ? albumUrls[Math.min(albumIndex, albumUrls.length - 1)] : undefined
  const palette = useCoverPalette(coverUrl)
  const hue = palette?.hue ?? nameHue(current?.name ?? '')
  const accent = palette?.accent ?? '#38bdf8'
  const accentRgb = palette?.accentRgb ?? '56,189,248'
  // 歌词白色/灰色系：背景深用白、背景浅用深灰，随背景深浅自动切换
  const darkBg = (palette?.luminance ?? 0.16) < 0.5
  const lyricStyle = {
    '--sq-lyric-base': darkBg
      ? '#ffffff'
      : '#3f3f46',
    '--sq-lyric-soft': darkBg
      ? 'rgba(255, 255, 255, 0.78)'
      : 'rgba(63, 63, 70, 0.72)',
    '--sq-lyric-dim': darkBg
      ? 'rgba(255, 255, 255, 0.5)'
      : 'rgba(63, 63, 70, 0.5)',
    '--sq-lyric-glow': darkBg
      ? `0 0 30px ${accent}4d, 0 2px 12px rgba(0,0,0,0.65)`
      : '0 2px 2px rgba(255,255,255,0.4), 0 2px 12px rgba(0,0,0,0.3)',
  } as const

  const toggle = () => usePlayerStore.getState().toggle()
  const cycleMode = () => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]
    // 离开流式播放即退出歌单队列（由引擎 setMode 处理）
    usePlayerStore.getState().setMode(next)
  }
  const applyVolume = (value: number) => usePlayerStore.getState().setVolume(value)
  const seekTo = (time: number) => usePlayerStore.getState().seekTo(Math.max(0, time - totalOffset))
  const seekProgress = (value: number) => usePlayerStore.getState().seekTo(value)
  const selectTrack = (file: ManagedFile) => {
    const player = usePlayerStore.getState()
    if (player.track?.assetId === file.assetId) {
      // 用引擎状态判断当前曲目是否在播放
      if (!player.playing) player.toggle()
      return
    }
    // 手动点选歌曲即退出歌单队列,回到全部歌曲的导航上下文
    player.setQueue(null)
    player.play(
      { assetId: file.assetId, name: file.name, nodeId: file.nodes[0]?.id },
      { autoplay: true },
    )
  }
  // 从歌单第 index 首开始播放（index=0 即整体播放该歌单）
  const openPlaylistAt = (playlist: Playlist, index: number) => {
    const track = playlist.tracks[index]
    if (!track) return
    const player = usePlayerStore.getState()
    player.setQueue({
      id: playlist.id,
      name: playlist.name,
      assetIds: playlist.tracks.map((item) => item.assetId),
    })
    player.setMode('flow')
    player.play(
      { assetId: track.assetId, name: track.name, nodeId: track.nodeId },
      { autoplay: true },
    )
  }
  const openPlaylist = (playlist: Playlist) => openPlaylistAt(playlist, 0)
  const downloadCurrent = async () => {
    if (!current) return
    try {
      const url = await getAssetUrl(current.assetId)
      const record = await db.assets.get(current.assetId)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = record?.name ?? current.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      toast('已开始下载', 'success')
    } catch {
      toast('下载失败', 'error')
    }
  }
  const toggleLiked = () => {
    setLiked((prev) => {
      const next = !prev
      if (current?.assetId) saveLiked(current.assetId, next)
      return next
    })
  }

  // 沉浸式播放器键盘快捷键：空格播放/暂停、←/→ 快退快进、↑/↓ 音量、L 喜欢
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      const player = usePlayerStore.getState()
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (player.track) player.toggle()
          break
        case 'ArrowLeft':
          e.preventDefault()
          player.seekBy(-10)
          break
        case 'ArrowRight':
          e.preventDefault()
          player.seekBy(10)
          break
        case 'ArrowUp':
          e.preventDefault()
          player.setVolume(Math.min(1, player.volume + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          player.setVolume(Math.max(0, player.volume - 0.1))
          break
        case 'KeyL':
          e.preventDefault()
          setLiked((prev) => {
            const next = !prev
            const id = currentRef.current?.assetId
            if (id) saveLiked(id, next)
            return next
          })
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    usePlayerStore.getState().setBarVisible(false)
    return () => {
      const state = usePlayerStore.getState()
      if (state.track && (state.playing || state.time > 0)) state.setBarVisible(true)
    }
  }, [])

  const updateLyricOffset = (change: (prev: number) => number) => {
    setLyricOffset((prev) => {
      const next = change(prev)
      if (current?.assetId) saveLyricOffset(current.assetId, next)
      return next
    })
  }

  useEffect(() => {
    setLyricOffset(loadLyricOffset(current?.assetId ?? ''))
  }, [current?.assetId])

  useEffect(() => {
    setLiked(loadLikedMap()[current?.assetId ?? ''] ?? false)
  }, [current?.assetId])

  useEffect(() => {
    if (mode === 'flow') {
      setFlowOrder(buildFlowOrder(current?.assetId ?? ''))
    } else {
      setFlowOrder([])
    }
    // 仅在进入/离开流式模式时重建顺序；切歌时由下面的 current 变化重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (mode === 'flow') {
      setFlowOrder(buildFlowOrder(current?.assetId ?? ''))
    }
  }, [current?.assetId, mode])

  useEffect(() => {
    const assetId = current?.assetId
    setLyrics(null)
    setLyricsSource(undefined)
    if (!assetId) {
      setLyricsState('none')
      return
    }
    setLyricsState('loading')
    let alive = true
    const mp3NodeIds = new Set(currentNodesRef.current.map((node) => node.id))
    // 画布上与当前 mp3 通过连线关联的 .lrc 文件节点
    const findConnectedLrc = (): string | undefined => {
      const { nodes: canvasNodes, edges } = useCanvasStore.getState()
      for (const edge of edges) {
        const otherId = mp3NodeIds.has(edge.source) ? edge.target : mp3NodeIds.has(edge.target) ? edge.source : null
        if (!otherId) continue
        const otherNode = canvasNodes.find((node) => node.id === otherId)
        if (otherNode?.data.assetId && /\.lrc$/i.test(otherNode.data.label ?? '')) {
          return otherNode.data.assetId
        }
      }
      return undefined
    }
    const connectedLrcAssetId = findConnectedLrc()
    const readLrcText = async (lrcAssetId: string, fallbackName: string) => {
      const record = await db.assets.get(lrcAssetId)
      const text = record?.blob ? await record.blob.text() : await fetch(await getAssetUrl(lrcAssetId)).then((res) => res.text())
      return { name: record?.name ?? fallbackName, text }
    }
    void loadLyricsFor(
      assetId,
      async (id) => {
        const record = await db.assets.get(id)
        return record?.blob ? { blob: record.blob, name: record.name } : undefined
      },
      async () => {
        if (!connectedLrcAssetId) return undefined
        try {
          return await readLrcText(connectedLrcAssetId, '歌词.lrc')
        } catch {
          return undefined
        }
      },
      connectedLrcAssetId ?? '',
    ).then((result) => {
      if (!alive) return
      setLyrics(result.data ?? null)
      setLyricsSource(result.sourceName)
      setLyricsState(result.data ? 'ready' : 'none')
    })
    return () => {
      alive = false
    }
  }, [current?.assetId])

  // 收集画布上与当前 mp3 通过连线（串联/并联均可）关联的图片作为专辑背景
  const findAlbumImages = (): string[] => {
    const { nodes: canvasNodes, edges } = useCanvasStore.getState()
    const currentNodes = currentNodesRef.current
    const startIds = new Set(currentNodes.map((node) => node.id))
    const collected: string[] = []
    // 节点上显式设置的专辑图优先
    for (const node of currentNodes) {
      if (node.data.coverAssetId && !collected.includes(node.data.coverAssetId)) {
        collected.push(node.data.coverAssetId)
      }
    }
    const visited = new Set<string>(startIds)
    const queue = [...startIds]
    let hops = 0
    while (queue.length > 0 && hops < 8) {
      const size = queue.length
      for (let i = 0; i < size; i++) {
        const nodeId = queue[i]
        for (const edge of edges) {
          const otherId = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null
          if (!otherId || visited.has(otherId)) continue
          visited.add(otherId)
          const otherNode = canvasNodes.find((node) => node.id === otherId)
          if (!otherNode) continue
          if (otherNode.data.kind === 'audio') continue
          if (otherNode.data.kind === 'image' && otherNode.data.assetId && !collected.includes(otherNode.data.assetId)) {
            collected.push(otherNode.data.assetId)
          }
          queue.push(otherId)
        }
      }
      queue.splice(0, size)
      hops += 1
    }
    return collected
  }

  // 节点显式设置的专辑图变化时（同一首歌）也重新收集背景
  const coverIdsKey = canvasNodes.map((node) => node.data.coverAssetId ?? '').join(',')

  useEffect(() => {
    const assetId = current?.assetId
    setAlbumUrls([])
    setAlbumIndex(0)
    if (!assetId) return
    const ids = findAlbumImages()
    if (ids.length === 0) return
    let alive = true
    void Promise.all(
      ids.map(async (id) => {
        try {
          const thumb = await getThumbnailUrl(id)
          if (thumb) return thumb
        } catch {
          // 无缩略图时回退原图
        }
        try {
          return await getAssetUrl(id)
        } catch {
          return undefined
        }
      }),
    ).then((urls) => {
      if (!alive) return
      setAlbumUrls(urls.filter((url): url is string => Boolean(url)))
    })
    return () => {
      alive = false
    }
    // 仅在切歌或封面变化时重新收集
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.assetId, coverIdsKey])

  // 多张专辑图时每 5 秒轮换一张(背景水波纹与唱片封面同步切换)
  useEffect(() => {
    if (albumUrls.length < 2) return
    const timer = setInterval(() => {
      setAlbumIndex((value) => (value + 1) % albumUrls.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [albumUrls.length])

  const activeIndex = useMemo(() => {
    if (!lyrics || lyrics.kind !== 'synced') return -1
    const t = currentTime + totalOffset
    let found = -1
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i].time <= t) found = i
      else break
    }
    return found
  }, [lyrics, currentTime, totalOffset])

  useEffect(() => {
    if (activeIndex < 0 || Date.now() < freezeUntilRef.current) return
    const container = scrollRef.current
    const line = lineRefs.current.get(activeIndex)
    if (!container || !line) return
    const containerRect = container.getBoundingClientRect()
    const lineRect = line.getBoundingClientRect()
    const top = container.scrollTop + lineRect.top - containerRect.top - containerRect.height / 2 + lineRect.height / 2
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [activeIndex])

  // 歌词倒影与正像逐帧对齐：镜像内层 top = 当前滚动位置 + 可视高度（翻转轴贴正像底部）
  const syncMirror = () => {
    const src = scrollRef.current
    const inner = mirrorRef.current
    if (!src || !inner) return
    inner.style.top = `${src.scrollTop + src.clientHeight}px`
  }

  useEffect(() => {
    syncMirror()
    window.addEventListener('resize', syncMirror)
    return () => window.removeEventListener('resize', syncMirror)
  }, [])

  useEffect(() => {
    lineRefs.current.clear()
    freezeUntilRef.current = 0
    scrollRef.current?.scrollTo({ top: 0 })
    syncMirror()
  }, [lyrics])

  if (!current) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-app text-sm text-dim">没有可播放的 MP3 文件</div>
  }

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-app text-main"
      style={{ '--sq-accent': accent, ...lyricStyle } as CSSProperties}
    >
      {/* 沉浸式水波纹背景（含 Web Audio 分析器） */}
      <AudioBackground coverUrl={coverUrl} playing={playing} hue={hue} tintRgb={palette?.tintRgb} />

      {/* 顶部浮动按钮 */}
      <div className="absolute left-5 top-5 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3.5 py-2 text-xs text-white/85 backdrop-blur-md transition-colors hover:bg-black/50 hover:text-white"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          返回
        </button>
      </div>
      <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
        <span className="hidden rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/70 backdrop-blur-md sm:inline">
          {queue
            ? `歌单「${queue.name}」· ${queue.assetIds.length} 首`
            : `共 ${mp3Files.length} 首`}
        </span>
        <button
          type="button"
          onClick={() => setQueueOpen((value) => !value)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs backdrop-blur-md transition-colors ${queueOpen ? 'border-transparent text-slate-950' : 'border-white/10 bg-black/30 text-white/85 hover:bg-black/50'}`}
          style={queueOpen ? { background: accent, boxShadow: `0 6px 20px rgba(${accentRgb}, 0.27)` } : undefined}
          title="播放队列"
        >
          <QueueIcon className="h-3.5 w-3.5" />
          队列
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/10 bg-black/30 p-2 text-white/85 backdrop-blur-md transition-colors hover:bg-black/50 hover:text-white"
          title="关闭播放器"
          aria-label="关闭播放器"
        >
          <CloseIcon />
        </button>
      </div>

      {/* 队列滑出面板 */}
      {queueOpen && (
        <>
          <div className="absolute inset-0 z-20 bg-black/40" onClick={() => setQueueOpen(false)} />
          <aside className="absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-edge bg-panel/95 backdrop-blur sm:w-80">
            <div className="flex items-center gap-1 border-b border-edge px-2 py-2">
              <button
                type="button"
                onClick={() => setAsideTab('songs')}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${asideTab === 'songs' ? 'bg-sky-500/15 font-medium text-sky-400' : 'text-soft hover:bg-hover'}`}
              >
                歌曲
              </button>
              <button
                type="button"
                onClick={() => setAsideTab('playlists')}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${asideTab === 'playlists' ? 'bg-sky-500/15 font-medium text-sky-400' : 'text-soft hover:bg-hover'}`}
              >
                歌单
                {playlists.length > 0 && (
                  <span className="ml-1 rounded-full bg-panel2 px-1.5 text-[10px] tabular-nums text-dim">{playlists.length}</span>
                )}
              </button>
              <button type="button" onClick={() => setQueueOpen(false)} className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main" title="关闭队列">
                <CloseIcon />
              </button>
            </div>
            {asideTab === 'songs' ? (
              <>
                <div className="border-b border-edge p-2">
                  <div className="flex items-center gap-2 rounded-md border border-edge2 bg-panel2 px-2.5 py-1.5">
                    <SearchIcon className="shrink-0 text-mid" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索歌曲或导入人"
                      className="min-w-0 flex-1 bg-transparent text-xs text-main outline-none placeholder:text-dim"
                    />
                    {query && <button type="button" title="清空搜索" className="text-dim hover:text-main" onClick={() => setQuery('')}><CloseIcon /></button>}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序方式" className="min-w-0 flex-1 rounded border border-edge2 bg-panel2 px-2 py-1 text-[11px] text-soft">
                      <option value="default">默认顺序</option>
                      <option value="title">按标题</option>
                      <option value="importer">按导入人</option>
                    </select>
                    <select value={mode} onChange={(event) => {
                      usePlayerStore.getState().setMode(event.target.value as PlaybackMode)
                    }} aria-label="播放模式" className="min-w-0 flex-1 rounded border border-edge2 bg-panel2 px-2 py-1 text-[11px] text-soft">
                      <option value="sequential">顺序播放</option>
                      <option value="loop">列表循环</option>
                      <option value="single">单曲循环</option>
                      <option value="random">随机播放</option>
                      <option value="flow">流式播放</option>
                    </select>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto py-2 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {visibleFiles.length > 0 ? visibleFiles.map((file) => {
                    const isActive = file.assetId === current.assetId
                    const flowPos = mode === 'flow' ? (queue?.assetIds ?? flowOrder).indexOf(file.assetId) : -1
                    return (
                      <button
                        key={file.assetId}
                        type="button"
                        className={`group flex w-full items-center gap-2.5 rounded-lg py-2 pl-1 pr-2.5 text-left transition-colors ${isActive ? 'bg-sky-500/15' : 'hover:bg-hover'}`}
                        onClick={() => selectTrack(file)}
                      >
                        <span className="flex w-5 shrink-0 justify-center">
                          {isActive && playing ? (
                            <span className="sq-eq"><span /><span /><span /></span>
                          ) : mode === 'flow' ? (
                            flowPos >= 0
                              ? <span className="text-[11px] tabular-nums text-sky-400/80">{flowPos + 1}</span>
                              : <span className="text-[11px] text-faint">–</span>
                          ) : (
                            <span className="text-[11px] tabular-nums text-dim">{orderedFiles.indexOf(file) + 1}</span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-xs ${isActive ? 'font-medium text-sky-400' : 'text-main'}`} title={file.name}>{file.name}</span>
                          <span className="block truncate text-[10px] text-dim">{file.nodes[0]?.data.createdByName ?? '未知'}</span>
                        </span>
                        {isActive && <AudioIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
                      </button>
                    )
                  }) : (
                    <div className="flex h-full min-h-32 items-center justify-center text-xs text-dim">没有匹配的歌曲</div>
                  )}
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {playlists.length === 0 ? (
                  <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1.5 px-4 text-center">
                    <span className="text-xs text-dim">画布上还没有歌单</span>
                    <span className="text-[10px] leading-relaxed text-faint">把文本节点连线指向第一个 MP3 节点,该文本就是歌单名;分叉处可在选中连线后设置播放顺序</span>
                  </div>
                ) : (
                  playlists.map((playlist) => {
                    const isActive = queue?.id === playlist.id
                    const expanded = expandedPlaylistId === playlist.id
                    const currentAssetId = track?.assetId
                    const activeTrackAssetId = playlist.tracks.some((item) => item.assetId === currentAssetId)
                      ? currentAssetId
                      : undefined
                    return (
                      <div
                        key={playlist.id}
                        className={`mb-2 overflow-hidden rounded-lg border transition-colors ${isActive ? 'border-sky-500/40 bg-sky-500/10' : 'border-edge2 bg-panel2'}`}
                      >
                        <div className="flex items-stretch">
                          <button
                            type="button"
                            onClick={() => openPlaylist(playlist)}
                            className={`min-w-0 flex-1 p-2.5 text-left transition-colors ${isActive ? '' : 'hover:bg-hover'}`}
                            title={`播放歌单「${playlist.name}」（${playlist.tracks.length} 首）`}
                          >
                            <div className="flex items-center gap-1.5">
                              <FlowIcon className="shrink-0 text-sky-400" />
                              <span className={`min-w-0 truncate text-xs font-medium ${isActive ? 'text-sky-400' : 'text-main'}`} title={playlist.name}>
                                {playlist.name}
                              </span>
                              {playlist.warnings.length > 0 && (
                                <span
                                  className="shrink-0 text-[10px] text-amber-400"
                                  title={playlist.warnings.join('；')}
                                >
                                  ⚠
                                </span>
                              )}
                              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-dim">{playlist.tracks.length} 首</span>
                            </div>
                            <div className="mt-1 truncate text-[10px] text-dim" title={playlist.tracks.map((item) => item.name).join(' → ')}>
                              {playlist.tracks.slice(0, 3).map((item) => item.name).join(' → ')}
                              {playlist.tracks.length > 3 ? ' …' : ''}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedPlaylistId(expanded ? null : playlist.id)}
                            className={`flex shrink-0 items-center border-l border-edge/60 px-2.5 transition-colors ${expanded ? 'text-sky-400' : 'text-soft hover:bg-hover hover:text-main'}`}
                            title={expanded ? '收起歌单预览' : '展开歌单预览'}
                            aria-expanded={expanded}
                            aria-label={expanded ? `收起歌单「${playlist.name}」` : `展开歌单「${playlist.name}」`}
                          >
                            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                          </button>
                        </div>
                        {expanded && (
                          <div className="border-t border-edge/60 py-1">
                            {playlist.tracks.map((playlistTrack, trackIndex) => {
                              const isPlaying = playlistTrack.assetId === activeTrackAssetId
                              return (
                                <button
                                  key={playlistTrack.nodeId}
                                  type="button"
                                  onClick={() => openPlaylistAt(playlist, trackIndex)}
                                  className={`group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${isPlaying ? 'bg-sky-500/10' : 'hover:bg-hover'}`}
                                  title={`从「${playlistTrack.name}」开始播放该歌单`}
                                >
                                  <span className="flex w-5 shrink-0 justify-center">
                                    {isPlaying && playing ? (
                                      <span className="sq-eq"><span /><span /><span /></span>
                                    ) : (
                                      <span className={`text-[11px] tabular-nums ${isPlaying ? 'text-sky-400' : 'text-faint'}`}>{trackIndex + 1}</span>
                                    )}
                                  </span>
                                  <span className={`min-w-0 flex-1 truncate text-xs ${isPlaying ? 'font-medium text-sky-400' : 'text-main'}`} title={playlistTrack.name}>
                                    {playlistTrack.name}
                                  </span>
                                  {isPlaying && <AudioIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </aside>
        </>
      )}

      {/* 中央内容：左侧标题+封面+唱片，右侧歌词 */}
      <div className="relative z-10 flex h-full min-h-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
          <section className="relative flex shrink-0 flex-col items-center justify-center px-6 py-6 pb-44 lg:w-[46%] lg:border-r lg:border-white/10 xl:w-[44%]">
            <div className="relative aspect-square w-[min(66vw,300px)] sm:w-[340px] lg:w-[380px] xl:w-[400px]">
              <div className="sq-disc-halo pointer-events-none absolute -inset-[22%] rounded-full" aria-hidden="true" />
              <div
                className={`sq-disc absolute inset-0 rounded-full ${playing ? '' : 'sq-disc-paused'}`}
                style={{ boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 90px hsla(${hue} 85% 60% / 0.16)` }}
              >
                <div className="sq-disc-grooves absolute inset-0 rounded-full" />
                <div className="absolute inset-[9%] rounded-full border border-white/10" />
                <div className="absolute inset-[24%] rounded-full border border-white/5" />
                <div className="absolute left-1/2 top-1/2 aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full ring-1 ring-white/25 shadow-2xl">
                  {albumUrls[0] ? (
                    <img src={albumUrls[0]} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center"
                      style={{ background: `linear-gradient(135deg, hsl(${hue} 38% 20%), hsl(${hue} 52% 32%))` }}
                    >
                      <AudioIcon className="h-1/3 w-1/3 text-white/40" />
                    </div>
                  )}
                </div>
                <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#04060a] ring-1 ring-white/25" />
              </div>
              <div className="sq-disc-shine pointer-events-none absolute inset-0 rounded-full" />
            </div>

            <div className="mt-10 w-full max-w-md px-2 text-center">
              <div className="flex items-center justify-center gap-2.5">
                <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight text-white sm:text-[1.8rem]" title={current.name} style={{ textShadow: '0 2px 16px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.4)' }}>
                  {current.name}
                </h1>
                <button
                  type="button"
                  title="下载当前歌曲"
                  className="shrink-0 rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                  onClick={() => void downloadCurrent()}
                >
                  <DownloadIcon />
                </button>
              </div>
              <p className="mt-2 truncate text-[13px] text-white/60" style={{ textShadow: '0 1px 10px rgba(0,0,0,0.5)' }}>
                {(lyrics?.meta.ar || lyrics?.meta.artist) && (
                  <span className="text-white/85">{lyrics?.meta.ar ?? lyrics?.meta.artist}</span>
                )}
                {(lyrics?.meta.ar || lyrics?.meta.artist) && <span className="mx-1.5 text-white/25">·</span>}
                <span className="text-white/45">导入人 {currentFile?.nodes[0]?.data.createdByName ?? '未知'}</span>
              </p>
              {currentPlaylist && queue?.id !== currentPlaylist.id && (
                <div className="mt-3.5">
                  <button
                    type="button"
                    onClick={() => openPlaylist(currentPlaylist)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] text-white/80 backdrop-blur transition-colors hover:border-white/25 hover:bg-white/20"
                    title={`点击按歌单「${currentPlaylist.name}」顺序播放`}
                  >
                    <FlowIcon className="h-3 w-3" style={{ color: accent }} />
                    <span className="font-medium">{currentPlaylist.name}</span>
                    <span className="text-white/40">歌单</span>
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="relative flex min-h-0 min-w-0 flex-1 flex-col pb-44 pl-2 pr-6 pt-20 lg:pt-16">
            <div className="mb-3 flex items-center gap-2 px-3">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--sq-lyric-soft)' }}>
                <span className="h-3.5 w-0.5 rounded-full" style={{ background: accent }} />
                歌词
              </span>
              {lyricsSource && <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] backdrop-blur" style={{ color: 'var(--sq-lyric-soft)' }}>{lyricsSource}</span>}
              <div className="flex-1" />
              {lyrics?.kind === 'synced' && (
                <div className="flex items-center gap-1">
                  <button type="button" className="rounded px-1.5 py-0.5 text-[10px] tabular-nums hover:bg-white/10" style={{ color: 'var(--sq-lyric-soft)' }} title="歌词提前 0.5 秒" onClick={() => updateLyricOffset((value) => value - 0.5)}>-0.5s</button>
                  {lyricOffset !== 0 && <button type="button" className="rounded px-1.5 py-0.5 text-[10px] tabular-nums" style={{ color: accent }} title="重置歌词偏移" onClick={() => updateLyricOffset(() => 0)}>{lyricOffset > 0 ? '+' : ''}{lyricOffset.toFixed(1)}s</button>}
                  <button type="button" className="rounded px-1.5 py-0.5 text-[10px] tabular-nums hover:bg-white/10" style={{ color: 'var(--sq-lyric-soft)' }} title="歌词延后 0.5 秒" onClick={() => updateLyricOffset((value) => value + 0.5)}>+0.5s</button>
                </div>
              )}
            </div>
            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollRef}
                onScroll={syncMirror}
                onWheel={() => { freezeUntilRef.current = Date.now() + 3000 }}
                onTouchMove={() => { freezeUntilRef.current = Date.now() + 3000 }}
                className="sq-lyric-mask h-full overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {lyricsState === 'loading' && <div className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--sq-lyric-soft)' }}>歌词加载中…</div>}
                {lyricsState === 'ready' && lyrics?.kind === 'synced' && lyrics.lines.map((line, lineIndex) => (
                  <button
                    key={lineIndex}
                    ref={(el) => { if (el) lineRefs.current.set(lineIndex, el); else lineRefs.current.delete(lineIndex) }}
                    type="button"
                    onClick={() => seekTo(line.time)}
                    title="点击跳转到该句"
                    className={`sq-lyric block w-full rounded-md px-3 py-2.5 text-center leading-relaxed ${lineIndex === activeIndex ? 'sq-lyric-active text-xl font-semibold sm:text-2xl' : 'sq-lyric-dim text-sm sm:text-base'}`}
                  >
                    {line.text || '\u00A0'}
                  </button>
                ))}
                {lyricsState === 'ready' && lyrics?.kind === 'unsynced' && (
                  <div className="space-y-2 px-3 py-2 text-center text-xs leading-6" style={{ color: 'var(--sq-lyric-base)' }}>
                    {lyrics.lines.map((line, lineIndex) => <p key={lineIndex} className="whitespace-pre-wrap">{line.text || '\u00A0'}</p>)}
                    <p className="pt-3 text-[10px]" style={{ color: 'var(--sq-lyric-dim)' }}>该歌曲只有未同步歌词，无法跟随播放滚动</p>
                  </div>
                )}
                {lyricsState === 'none' && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 backdrop-blur"
                      style={{ background: `linear-gradient(135deg, ${accent}26, ${accent}0d)`, boxShadow: `0 8px 30px rgba(${accentRgb}, 0.14)` }}
                    >
                      <AudioIcon className="h-6 w-6" style={{ color: 'var(--sq-lyric-soft)' }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--sq-lyric-base)' }}>暂无歌词</p>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--sq-lyric-dim)' }}>跟着旋律哼唱，也可以为它配上歌词</p>
                    </div>
                    <div className="mt-1 w-full max-w-72 space-y-2 text-left">
                      <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 backdrop-blur">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: accent, color: '#06121f' }}>1</span>
                        <span className="text-[11px] leading-relaxed" style={{ color: 'var(--sq-lyric-soft)' }}>导入 .lrc 文件并在画布上连线指向该歌曲，即可作为同步歌词</span>
                      </div>
                      <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 backdrop-blur">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: accent, color: '#06121f' }}>2</span>
                        <span className="text-[11px] leading-relaxed" style={{ color: 'var(--sq-lyric-soft)' }}>内嵌歌词（ID3）的 MP3 打开后自动识别</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* 歌词倒影：镜像翻转 + 整体模糊，滚动与正像同步，没入水面后被覆盖层压暗 */}
              <div aria-hidden className="sq-lyric-mirror pointer-events-none absolute inset-x-0 top-full h-full">
                <div ref={mirrorRef} className="sq-lyric-mirror-inner absolute inset-x-0">
                  {lyricsState === 'ready' && lyrics?.kind === 'synced' && lyrics.lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={`sq-lyric block w-full rounded-md px-3 py-2.5 text-center leading-relaxed ${lineIndex === activeIndex ? 'sq-lyric-active text-xl font-semibold sm:text-2xl' : 'sq-lyric-dim text-sm sm:text-base'}`}
                    >
                      {line.text || '\u00A0'}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 底部控制栏 */}
      <footer className="absolute inset-x-0 bottom-0 z-20 px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-2xl rounded-[1.4rem] border border-white/10 bg-black/35 px-5 py-4 shadow-2xl backdrop-blur-xl sm:px-7 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-white/55">{formatTime(currentTime)}</span>
            <input
              aria-label="播放进度"
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => seekProgress(Number(event.target.value))}
              className="sq-range min-w-0 flex-1"
              style={{ '--sq-fill': `${progress}%` } as CSSProperties}
            />
            <span className="w-10 shrink-0 text-[11px] tabular-nums text-white/55">{formatTime(duration)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={toggleLiked}
              className={`rounded-full p-3 transition-colors ${liked ? 'text-rose-400' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              title={liked ? '取消喜欢' : '喜欢'}
            >
              <HeartIcon className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3 sm:gap-5">
              <button
                type="button"
                className="rounded-full p-3 text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                title="上一首"
                onClick={() => usePlayerStore.getState().prev()}
                disabled={orderedFiles.length < 2}
              >
                <PrevIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                className="flex h-14 w-14 items-center justify-center rounded-full text-slate-950 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
                style={{ background: accent, boxShadow: `0 10px 32px rgba(${accentRgb}, 0.33)` }}
                onClick={toggle}
                disabled={!track}
              >
                {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6 translate-x-0.5" />}
              </button>
              <button
                type="button"
                className="rounded-full p-3 text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                title="下一首"
                onClick={() => usePlayerStore.getState().next({ wrap: true })}
                disabled={orderedFiles.length < 2}
              >
                <NextIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="rounded-full p-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                title={mode === 'flow' && flowOrder.length <= 1 ? `${MODE_LABELS[mode]}（该歌曲未连线其他音频）` : MODE_LABELS[mode]}
                onClick={cycleMode}
              >
                <ModeGlyph mode={mode} />
              </button>
              <button
                type="button"
                className="rounded-full p-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                title={muted ? '取消静音' : '静音'}
                onClick={() => usePlayerStore.getState().setMuted(!muted)}
              >
                {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
              </button>
              <input
                aria-label="音量"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(event) => applyVolume(Number(event.target.value))}
                className="sq-range hidden w-20 sm:block"
                style={{ '--sq-fill': `${volume * 100}%` } as CSSProperties}
              />
              <button type="button" className="rounded-full p-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white" title="更多选项（播放队列）" onClick={() => setQueueOpen(true)}>
                <MoreIcon />
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
