import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AudioIcon,
  CloseIcon,
  DownloadIcon,
  KindIcon,
  MuteIcon,
  NextIcon,
  OpenIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  SearchIcon,
  SequentialIcon,
  ShuffleIcon,
  TrashIcon,
  VolumeIcon,
} from '../canvas/nodes/Icons'
import { db, type AssetRecord } from '../db/db'
import { formatBytes } from '../media/fileKind'
import { getAssetUrl, invalidateAllAssetUrls } from '../media/blobRegistry'
import { baseName, loadLyricsFor, type LyricsData } from '../media/lyrics'
import { useAssetUrl } from '../media/useAssetUrl'
import { fuzzyScore } from '../search/fuzzySearch'
import { useCanvasStore } from '../store/canvasStore'
import { useLanStore } from '../store/lanStore'
import { setPlayerEndedHandler, usePlayerStore } from '../store/playerStore'
import { useProjectStore } from '../store/projectStore'
import { toast, useUiStore } from '../store/uiStore'
import type { MediaKind, SuqNode } from '../types'

interface ManagedFile {
  assetId: string
  name: string
  kind: MediaKind
  mime: string
  size: number
  nodes: SuqNode[]
}

interface TypeGroup {
  id: string
  label: string
  kinds: MediaKind[]
}

type PlaybackMode = 'sequential' | 'random' | 'loop' | 'single'

function isMp3(file: ManagedFile): boolean {
  return file.kind === 'audio' && (file.mime.toLowerCase() === 'audio/mpeg' || /\.mp3$/i.test(file.name))
}

const MODE_ORDER: PlaybackMode[] = ['sequential', 'loop', 'single', 'random']

const MODE_LABELS: Record<PlaybackMode, string> = {
  sequential: '顺序播放',
  random: '随机播放',
  loop: '列表循环',
  single: '单曲循环',
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

function ModeGlyph({ mode }: { mode: PlaybackMode }) {
  if (mode === 'random') return <ShuffleIcon />
  if (mode === 'single') return <RepeatOneIcon />
  if (mode === 'loop') return <RepeatIcon />
  return <SequentialIcon />
}

function AudioPlayerView({
  files,
  initialAssetId,
  onBack,
}: {
  files: ManagedFile[]
  initialAssetId: string
  onBack: () => void
}) {
  const mp3Files = useMemo(() => files.filter(isMp3), [files])
  const [sort, setSort] = useState<'default' | 'title' | 'importer'>('default')
  const [mode, setMode] = useState<PlaybackMode>('sequential')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(() => Math.max(0, mp3Files.findIndex((file) => file.assetId === initialAssetId)))
  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [lyricsSource, setLyricsSource] = useState<string>()
  const [lyricsState, setLyricsState] = useState<'loading' | 'ready' | 'none'>('loading')
  const [lyricOffset, setLyricOffset] = useState(0)
  const playing = usePlayerStore((s) => s.playing)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const autoplayRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef(new Map<number, HTMLButtonElement>())
  const freezeUntilRef = useRef(0)
  const filesRef = useRef(files)
  filesRef.current = files
  const currentNameRef = useRef('')

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
  const current = orderedFiles[index] ?? orderedFiles[0]
  const url = useAssetUrl(current?.assetId)
  const hue = nameHue(current?.name ?? '')
  currentNameRef.current = current?.name ?? ''
  const totalOffset = (lyrics?.offsetMs ?? 0) / 1000 + lyricOffset
  const progress = duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0

  const nextTrack = (wrap: boolean): boolean => {
    if (orderedFiles.length < 2) return false
    if (mode === 'random') {
      let next = index
      while (next === index) next = Math.floor(Math.random() * orderedFiles.length)
      setIndex(next)
      return true
    }
    if (index < orderedFiles.length - 1) {
      setIndex(index + 1)
      return true
    }
    if (mode === 'loop' || wrap) {
      setIndex(0)
      return true
    }
    return false
  }
  const prevTrack = () => {
    autoplayRef.current = true
    setIndex(index > 0 ? index - 1 : orderedFiles.length - 1)
  }
  const toggle = () => usePlayerStore.getState().toggle()
  const cycleMode = () => setMode((currentMode) => MODE_ORDER[(MODE_ORDER.indexOf(currentMode) + 1) % MODE_ORDER.length])
  const applyVolume = (value: number) => usePlayerStore.getState().setVolume(value)
  const seekTo = (time: number) => usePlayerStore.getState().seekTo(Math.max(0, time - totalOffset))
  const seekProgress = (value: number) => usePlayerStore.getState().seekTo(value)
  const selectTrack = (file: ManagedFile) => {
    const fileIndex = orderedFiles.findIndex((item) => item.assetId === file.assetId)
    if (fileIndex < 0) return
    if (fileIndex === index) {
      const player = usePlayerStore.getState()
      if (!player.playing) player.toggle()
      return
    }
    autoplayRef.current = true
    setIndex(fileIndex)
  }
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

  useEffect(() => {
    setIndex((currentIndex) => Math.min(currentIndex, Math.max(0, orderedFiles.length - 1)))
  }, [orderedFiles.length])

  useEffect(() => {
    const assetId = current?.assetId
    if (!assetId) {
      usePlayerStore.getState().setTrack(null)
      return
    }
    let alive = true
    void getAssetUrl(assetId)
      .then((resolvedUrl) => {
        if (!alive) return
        usePlayerStore.getState().setTrack(
          { assetId, name: currentNameRef.current, url: resolvedUrl },
          { autoplay: autoplayRef.current },
        )
        autoplayRef.current = false
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [current?.assetId])

  useEffect(() => {
    usePlayerStore.getState().setBarVisible(false)
    return () => {
      const state = usePlayerStore.getState()
      if ((state.track && (state.playing || state.currentTime > 0)) || state.external) state.setBarVisible(true)
    }
  }, [])

  useEffect(() => {
    setPlayerEndedHandler(() => {
      if (mode === 'single') {
        const player = usePlayerStore.getState()
        player.seekTo(0)
        player.toggle()
      } else {
        // 顺序播放最后一首播完即停；列表循环/随机自然播完时从头或随机继续
        autoplayRef.current = nextTrack(mode === 'loop')
      }
    })
    return () => setPlayerEndedHandler(null)
  })

  useEffect(() => {
    setLyricOffset(0)
  }, [current?.assetId])

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
    const songName = currentNameRef.current
    void loadLyricsFor(
      assetId,
      async (id) => {
        const record = await db.assets.get(id)
        return record?.blob ? { blob: record.blob, name: record.name } : undefined
      },
      async () => {
        const target = baseName(songName)
        const lrcFile = filesRef.current.find((file) => file.assetId !== assetId && /\.lrc$/i.test(file.name) && baseName(file.name) === target)
        if (!lrcFile) return undefined
        try {
          const record = await db.assets.get(lrcFile.assetId)
          const text = record?.blob ? await record.blob.text() : await fetch(await getAssetUrl(lrcFile.assetId)).then((res) => res.text())
          return { name: lrcFile.name, text }
        } catch {
          return undefined
        }
      },
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

  useEffect(() => {
    lineRefs.current.clear()
    freezeUntilRef.current = 0
    scrollRef.current?.scrollTo({ top: 0 })
  }, [lyrics])

  if (!current) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-app text-sm text-dim">没有可播放的 MP3 文件</div>
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-app text-main">
      <div className="flex h-13 shrink-0 items-center gap-3 border-b border-edge bg-panel px-4">
        <button type="button" className="rounded-md px-2 py-1 text-xs text-soft hover:bg-hover hover:text-main" onClick={onBack}>← 返回文件列表</button>
        <span className="flex items-center gap-2 text-sm font-medium"><AudioIcon className="text-sky-400" /> MP3 播放器</span>
        <div className="flex-1" />
        <span className="hidden text-xs text-dim sm:inline">共 {mp3Files.length} 首</span>
        <button type="button" title="关闭播放器" aria-label="关闭播放器" className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main" onClick={onBack}><CloseIcon /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-edge bg-panel lg:w-72 lg:border-b-0 lg:border-r xl:w-80">
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
            <span className="text-xs font-medium text-soft">音乐列表</span>
            <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] tabular-nums text-dim">{mp3Files.length}</span>
          </div>
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
              <select value={mode} onChange={(event) => setMode(event.target.value as PlaybackMode)} aria-label="播放模式" className="min-w-0 flex-1 rounded border border-edge2 bg-panel2 px-2 py-1 text-[11px] text-soft">
                <option value="sequential">顺序播放</option>
                <option value="loop">列表循环</option>
                <option value="single">单曲循环</option>
                <option value="random">随机播放</option>
              </select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visibleFiles.length > 0 ? visibleFiles.map((file) => {
              const isActive = file.assetId === current.assetId
              return (
                <button
                  key={file.assetId}
                  type="button"
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isActive ? 'bg-sky-500/15' : 'hover:bg-hover'}`}
                  onClick={() => selectTrack(file)}
                >
                  <span className="flex w-5 shrink-0 justify-center">
                    {isActive && playing ? (
                      <span className="sq-eq"><span /><span /><span /></span>
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
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
          <section className="flex shrink-0 flex-col items-center justify-center gap-6 border-b border-edge p-6 lg:w-[42%] lg:border-b-0 lg:border-r xl:w-[44%]">
            <div className="relative">
              <div className="absolute -inset-8 rounded-full opacity-40 blur-2xl" style={{ background: `radial-gradient(circle, hsl(${hue} 75% 60%) 0%, transparent 70%)` }} />
              <div className={`sq-disc relative aspect-square w-40 rounded-full sm:w-52 ${playing ? '' : 'sq-disc-paused'}`}>
                <div className="absolute inset-0 rounded-full border border-edge2" style={{ background: 'repeating-radial-gradient(circle, var(--panel2) 0 2px, var(--panel) 2px 4px)' }} />
                <div className="absolute inset-[20%] rounded-full border border-edge2" style={{ background: 'repeating-radial-gradient(circle, var(--panel2) 0 1.5px, var(--panel) 1.5px 3px)' }} />
                <div className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full border border-edge2 bg-panel2 shadow-xl sm:h-16 sm:w-16">
                  <AudioIcon className="h-6 w-6 sm:h-7 sm:w-7" style={{ color: `hsl(${hue} 75% 60%)` }} />
                </div>
              </div>
            </div>
            <div className="w-full max-w-sm text-center">
              <div className="flex items-center justify-center gap-2">
                <h2 className="min-w-0 truncate text-base font-semibold" title={current.name}>{current.name}</h2>
                <button
                  type="button"
                  title="下载当前歌曲"
                  className="shrink-0 rounded p-1.5 text-soft hover:bg-hover hover:text-main"
                  onClick={() => void downloadCurrent()}
                >
                  <DownloadIcon />
                </button>
              </div>
              <p className="mt-1 truncate text-xs text-dim">
                {lyrics?.meta.ar || lyrics?.meta.artist ? `${lyrics.meta.ar ?? lyrics.meta.artist} · ` : ''}
                导入人：{current.nodes[0]?.data.createdByName ?? '未知'}
              </p>
            </div>
            <div className="flex w-full max-w-sm items-center gap-3">
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-dim">{formatTime(currentTime)}</span>
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
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-dim">{formatTime(duration)}</span>
            </div>
            <div className="flex w-full max-w-sm items-center justify-between">
              <div className="flex w-24 items-center">
                <button type="button" className="rounded-full p-2 text-soft hover:bg-hover hover:text-main" title={MODE_LABELS[mode]} onClick={cycleMode}>
                  <ModeGlyph mode={mode} />
                </button>
                <span className="ml-1 hidden text-[10px] text-faint xl:inline">{MODE_LABELS[mode]}</span>
              </div>
              <div className="flex items-center gap-4">
                <button type="button" className="rounded-full p-2.5 text-soft hover:bg-hover hover:text-main disabled:opacity-30" title="上一首" onClick={prevTrack} disabled={orderedFiles.length < 2}><PrevIcon /></button>
                <button type="button" className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40" onClick={toggle} disabled={!url}>
                  {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6 translate-x-px" />}
                </button>
                <button type="button" className="rounded-full p-2.5 text-soft hover:bg-hover hover:text-main disabled:opacity-30" title="下一首" onClick={() => { autoplayRef.current = true; nextTrack(true) }} disabled={orderedFiles.length < 2}><NextIcon /></button>
              </div>
              <div className="flex w-28 items-center justify-end gap-1.5">
                <button type="button" className="rounded p-1.5 text-soft hover:bg-hover hover:text-main" title={muted ? '取消静音' : '静音'} onClick={() => usePlayerStore.getState().setMuted(!muted)}>
                  {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
                </button>
                <input aria-label="音量" type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => applyVolume(Number(event.target.value))} className="sq-range w-16 sm:w-20" />
              </div>
            </div>
          </section>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4">
              <span className="text-xs font-medium text-soft">歌词</span>
              {lyricsSource && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-400">{lyricsSource}</span>}
              <div className="flex-1" />
              {lyrics?.kind === 'synced' && (
                <div className="flex items-center gap-1">
                  <button type="button" className="rounded px-1.5 py-0.5 text-[10px] tabular-nums text-soft hover:bg-hover" title="歌词提前 0.5 秒" onClick={() => setLyricOffset((value) => value - 0.5)}>-0.5s</button>
                  {lyricOffset !== 0 && <button type="button" className="rounded px-1.5 py-0.5 text-[10px] tabular-nums text-sky-400 hover:bg-hover" title="重置歌词偏移" onClick={() => setLyricOffset(0)}>{lyricOffset > 0 ? '+' : ''}{lyricOffset.toFixed(1)}s</button>}
                  <button type="button" className="rounded px-1.5 py-0.5 text-[10px] tabular-nums text-soft hover:bg-hover" title="歌词延后 0.5 秒" onClick={() => setLyricOffset((value) => value + 0.5)}>+0.5s</button>
                </div>
              )}
            </div>
            <div
              ref={scrollRef}
              onWheel={() => { freezeUntilRef.current = Date.now() + 3000 }}
              onTouchMove={() => { freezeUntilRef.current = Date.now() + 3000 }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4"
            >
              {lyricsState === 'loading' && <div className="flex h-full items-center justify-center text-xs text-dim">歌词加载中…</div>}
              {lyricsState === 'ready' && lyrics?.kind === 'synced' && lyrics.lines.map((line, lineIndex) => (
                <button
                  key={lineIndex}
                  ref={(el) => { if (el) lineRefs.current.set(lineIndex, el); else lineRefs.current.delete(lineIndex) }}
                  type="button"
                  onClick={() => seekTo(line.time)}
                  title="点击跳转到该句"
                  className={`block w-full rounded-md px-3 py-1.5 text-center transition-all duration-300 ${lineIndex === activeIndex ? 'text-base font-semibold text-sky-400' : 'text-sm text-soft/70 hover:text-soft'}`}
                >
                  {line.text || '\u00A0'}
                </button>
              ))}
              {lyricsState === 'ready' && lyrics?.kind === 'unsynced' && (
                <div className="space-y-2 px-3 py-2 text-center text-xs leading-6 text-soft/80">
                  {lyrics.lines.map((line, lineIndex) => <p key={lineIndex} className="whitespace-pre-wrap">{line.text || '\u00A0'}</p>)}
                  <p className="pt-3 text-[10px] text-faint">该歌曲只有未同步歌词，无法跟随播放滚动</p>
                </div>
              )}
              {lyricsState === 'none' && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <AudioIcon className="h-8 w-8 text-faint" />
                  <p className="text-xs text-dim">暂无歌词</p>
                  <p className="max-w-64 text-[11px] leading-relaxed text-faint">上传与歌曲同名的 .lrc 文件即可自动匹配；内嵌歌词（ID3）的 MP3 也会自动识别</p>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

const TYPE_GROUPS: TypeGroup[] = [
  { id: 'media', label: '媒体', kinds: ['image', 'psd', 'video', 'audio'] },
  { id: 'document', label: '文档', kinds: ['pdf', 'markdown', 'text'] },
  { id: 'other', label: '其他', kinds: ['file'] },
]

const KIND_LABELS: Record<MediaKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  pdf: 'PDF',
  psd: 'PSD',
  markdown: 'Markdown',
  text: '文本',
  file: '其他文件',
  heading: '标题',
  sticky: '便签',
  shape: '图形',
}

function collectFiles(nodes: SuqNode[], records: Map<string, AssetRecord>): ManagedFile[] {
  const grouped = new Map<string, SuqNode[]>()
  for (const node of nodes) {
    if (!node.data.assetId) continue
    const list = grouped.get(node.data.assetId) ?? []
    list.push(node)
    grouped.set(node.data.assetId, list)
  }
  return [...grouped.entries()].map(([assetId, linkedNodes]) => {
    const node = linkedNodes[0]
    const record = records.get(assetId)
    return {
      assetId,
      name: record?.name ?? node.data.label ?? '未命名文件',
      kind: record?.kind ?? node.data.kind,
      mime: record?.mime ?? node.data.mime ?? '',
      size: record?.size ?? node.data.fileSize ?? 0,
      nodes: linkedNodes,
    }
  })
}

function matchesFile(file: ManagedFile, query: string): boolean {
  const tokens = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const fields = [
    file.name,
    file.mime,
    file.kind,
    KIND_LABELS[file.kind],
    ...file.nodes.map((node) => node.data.createdByName ?? ''),
  ]
  return tokens.every((token) => fields.some((field) => fuzzyScore(field, token) !== null))
}

function triggerDownload(url: string, name: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function FileManagerModal() {
  const open = useUiStore((state) => state.fileManagerOpen)
  const setOpen = useUiStore((state) => state.setFileManagerOpen)
  const nodes = useCanvasStore((state) => state.nodes)
  const removeAssets = useCanvasStore((state) => state.removeAssets)
  const editing = useLanStore((state) => state.editing)
  const selfId = useLanStore((state) => state.selfId)
  const [records, setRecords] = useState<Map<string, AssetRecord>>(new Map())
  const [query, setQuery] = useState('')
  const [selectedKind, setSelectedKind] = useState<MediaKind | 'all'>('all')
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(TYPE_GROUPS.map((group) => group.id)))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [playerAssetId, setPlayerAssetId] = useState<string | null>(null)

  const assetIds = useMemo(
    () => [...new Set(nodes.map((node) => node.data.assetId).filter((id): id is string => Boolean(id)))],
    [nodes],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault()
        setOpen(true)
      } else if (event.key === 'Escape' && useUiStore.getState().fileManagerOpen) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    let alive = true
    void db.assets.bulkGet(assetIds).then((items) => {
      if (!alive) return
      setRecords(new Map(items.filter((item): item is AssetRecord => Boolean(item)).map((item) => [item.id, item])))
    })
    return () => {
      alive = false
    }
  }, [assetIds, open])

  const files = useMemo(() => collectFiles(nodes, records), [nodes, records])
  const visibleFiles = useMemo(
    () => files.filter((file) => (selectedKind === 'all' || file.kind === selectedKind) && matchesFile(file, query)),
    [files, query, selectedKind],
  )
  const selectedFiles = files.filter((file) => selectedIds.has(file.assetId))
  const lockedNodeIds = new Set(
    Object.values(editing).filter((item) => item.userId !== selfId).map((item) => item.nodeId),
  )

  useEffect(() => {
    const existingIds = new Set(files.map((file) => file.assetId))
    setSelectedIds((current) => new Set([...current].filter((id) => existingIds.has(id))))
  }, [files])

  if (!open) return null
  if (playerAssetId) {
    return <AudioPlayerView files={files} initialAssetId={playerAssetId} onBack={() => setPlayerAssetId(null)} />
  }

  const openFile = async (file: ManagedFile) => {
    const ui = useUiStore.getState()
    const nodeId = file.nodes[0]?.id
    if (file.kind === 'markdown' && file.nodes.some((node) => lockedNodeIds.has(node.id))) {
      toast('该 Markdown 正在被其他人操作，暂时无法打开', 'error')
      return
    }
    if (isMp3(file)) {
      setPlayerAssetId(file.assetId)
    } else if (file.kind === 'image') {
      setOpen(false)
      ui.openImageViewer(file.assetId, file.name)
    } else if (file.kind === 'psd') {
      setOpen(false)
      ui.openImageViewer(file.assetId, file.name, true)
    } else if (file.kind === 'pdf') {
      setOpen(false)
      ui.openPdfViewer(file.assetId, file.name)
    } else if (file.kind === 'markdown') {
      setOpen(false)
      ui.openMarkdownViewer(file.assetId, file.name, nodeId)
    }
    else {
      try {
        const url = await getAssetUrl(file.assetId)
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        toast('文件打开失败', 'error')
      }
    }
  }

  const downloadFiles = async (targets: ManagedFile[]) => {
    if (targets.length === 0) return
    setBusy(true)
    let completed = 0
    for (const file of targets) {
      try {
        const url = await getAssetUrl(file.assetId)
        triggerDownload(url, file.name)
        completed += 1
        if (targets.length > 1) await new Promise((resolve) => setTimeout(resolve, 120))
      } catch {
        toast(`「${file.name}」下载失败`, 'error')
      }
    }
    setBusy(false)
    if (completed > 0) toast(`已开始下载 ${completed} 个文件`, 'success')
  }

  const deleteFiles = async (targets: ManagedFile[]) => {
    if (targets.length === 0) return
    const locked = targets.filter((file) => file.nodes.some((node) => lockedNodeIds.has(node.id)))
    if (locked.length > 0) {
      toast(`有 ${locked.length} 个文件正在被其他人操作，无法删除`, 'error')
      return
    }
    const nodeCount = targets.reduce((total, file) => total + file.nodes.length, 0)
    if (!window.confirm(`确定删除 ${targets.length} 个文件及其关联的 ${nodeCount} 个画布元素吗？`)) return
    setBusy(true)
    const ids = targets.map((file) => file.assetId)
    removeAssets(ids)
    const currentProjectId = useProjectStore.getState().projectId
    const otherProjects = (await db.projects.toArray()).filter((project) => project.id !== currentProjectId)
    const referencedElsewhere = new Set(
      otherProjects.flatMap((project) =>
        project.graph.nodes.map((node) => node.data.assetId).filter((id): id is string => Boolean(id)),
      ),
    )
    const deletableIds = ids.filter((id) => !referencedElsewhere.has(id))
    await db.assets.bulkDelete(deletableIds)
    for (const id of deletableIds) invalidateAllAssetUrls(id)
    setSelectedIds(new Set())
    setRecords((current) => {
      const next = new Map(current)
      for (const id of ids) next.delete(id)
      return next
    })
    setBusy(false)
    toast(`已删除 ${targets.length} 个文件`, 'success')
  }

  const allVisibleSelected = visibleFiles.length > 0 && visibleFiles.every((file) => selectedIds.has(file.assetId))

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-app text-main">
      <div className="flex h-13 shrink-0 items-center gap-3 border-b border-edge bg-panel px-4">
        <span className="shrink-0 text-sm font-medium">文件管理</span>
        <div className="flex h-8 min-w-48 max-w-md flex-1 items-center gap-2 rounded-md border border-edge2 bg-panel2 px-2.5">
          <SearchIcon className="shrink-0 text-mid" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件名、类型或插入者"
            className="min-w-0 flex-1 bg-transparent text-xs text-main outline-none placeholder:text-dim"
          />
          {query && (
            <button type="button" title="清空搜索" className="text-dim hover:text-main" onClick={() => setQuery('')}>
              <CloseIcon />
            </button>
          )}
        </div>
        <span className="hidden shrink-0 text-xs text-dim sm:inline">{files.length} 个文件</span>
        <button
          type="button"
          title="关闭文件管理"
          aria-label="关闭文件管理"
          className="rounded-md p-1.5 text-soft hover:bg-hover hover:text-main"
          onClick={() => setOpen(false)}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-48 shrink-0 overflow-y-auto border-r border-edge bg-panel p-2 md:block">
          <button
            type="button"
            className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-xs ${selectedKind === 'all' ? 'bg-sky-600 text-white' : 'text-soft hover:bg-hover'}`}
            onClick={() => setSelectedKind('all')}
          >
            <span>全部资源</span><span>{files.length}</span>
          </button>
          {TYPE_GROUPS.map((group) => {
            const expanded = expandedGroups.has(group.id)
            const groupCount = files.filter((file) => group.kinds.includes(file.kind)).length
            if (groupCount === 0) return null
            return (
              <div key={group.id} className="mt-1">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-soft hover:bg-hover"
                  onClick={() => setExpandedGroups((current) => {
                    const next = new Set(current)
                    if (next.has(group.id)) next.delete(group.id)
                    else next.add(group.id)
                    return next
                  })}
                >
                  <span>{expanded ? '▾' : '▸'} {group.label}</span><span className="text-dim">{groupCount}</span>
                </button>
                {expanded && group.kinds.map((kind) => {
                  const count = files.filter((file) => file.kind === kind).length
                  if (count === 0) return null
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={`flex w-full items-center justify-between rounded-md py-1.5 pl-6 pr-2 text-xs ${selectedKind === kind ? 'bg-hover text-main' : 'text-dim hover:bg-hover hover:text-soft'}`}
                      onClick={() => setSelectedKind(kind)}
                    >
                      <span>{KIND_LABELS[kind]}</span><span>{count}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-3">
            <select
              value={selectedKind}
              onChange={(event) => setSelectedKind(event.target.value as MediaKind | 'all')}
              aria-label="文件类型"
              className="max-w-28 rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-soft md:hidden"
            >
              <option value="all">全部资源</option>
              {TYPE_GROUPS.flatMap((group) => group.kinds).map((kind) => (
                files.some((file) => file.kind === kind) && <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-soft">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => setSelectedIds((current) => {
                  const next = new Set(current)
                  for (const file of visibleFiles) {
                    if (allVisibleSelected) next.delete(file.assetId)
                    else next.add(file.assetId)
                  }
                  return next
                })}
              />
              {selectedIds.size > 0 ? `已选择 ${selectedIds.size} 项` : '全选当前列表'}
            </label>
            <div className="flex-1" />
            <button
              type="button"
              disabled={selectedFiles.length === 0 || busy}
              className="flex items-center gap-1.5 rounded-md border border-edge2 px-2.5 py-1.5 text-xs text-soft hover:bg-hover disabled:opacity-35"
              onClick={() => void downloadFiles(selectedFiles)}
            >
              <DownloadIcon /> 下载
            </button>
            <button
              type="button"
              disabled={selectedFiles.length === 0 || busy}
              className="flex items-center gap-1.5 rounded-md border border-rose-500/30 px-2.5 py-1.5 text-xs text-rose-500 hover:bg-rose-500/10 disabled:opacity-35"
              onClick={() => void deleteFiles(selectedFiles)}
            >
              <TrashIcon /> 删除
            </button>
          </div>

          <div className="grid h-9 shrink-0 grid-cols-[36px_minmax(0,1fr)_110px] items-center border-b border-edge bg-panel2 px-3 text-[11px] text-dim lg:grid-cols-[36px_minmax(180px,1fr)_110px_100px_110px]">
            <span /><span>名称</span><span className="hidden lg:block">类型</span><span className="hidden lg:block">大小</span><span className="text-right">操作</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleFiles.length > 0 ? visibleFiles.map((file) => (
              <div
                key={file.assetId}
                className="grid min-h-12 grid-cols-[36px_minmax(0,1fr)_110px] items-center border-b border-edge px-3 hover:bg-hover/60 lg:grid-cols-[36px_minmax(180px,1fr)_110px_100px_110px]"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(file.assetId)}
                  onChange={() => setSelectedIds((current) => {
                    const next = new Set(current)
                    if (next.has(file.assetId)) next.delete(file.assetId)
                    else next.add(file.assetId)
                    return next
                  })}
                  aria-label={`选择 ${file.name}`}
                />
                <button type="button" className="flex min-w-0 items-center gap-2 text-left" onDoubleClick={() => void openFile(file)} onClick={() => { if (isMp3(file)) void openFile(file); else setSelectedIds(new Set([file.assetId])) }}>
                  <span className="shrink-0 text-mid"><KindIcon kind={file.kind} /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-main" title={file.name}>{file.name}</span>
                    <span className="block truncate text-[10px] text-dim">{file.mime || '未知格式'} · {file.nodes.length} 个元素</span>
                  </span>
                </button>
                <span className="hidden text-xs text-soft lg:block">{KIND_LABELS[file.kind]}</span>
                <span className="hidden text-xs tabular-nums text-dim lg:block">{file.size ? formatBytes(file.size) : '—'}</span>
                <div className="flex justify-end gap-1">
                  <button type="button" title="查看" className="rounded p-1.5 text-soft hover:bg-panel hover:text-main" onClick={() => void openFile(file)}><OpenIcon /></button>
                  <button type="button" title="下载" className="rounded p-1.5 text-soft hover:bg-panel hover:text-main" onClick={() => void downloadFiles([file])}><DownloadIcon /></button>
                  <button type="button" title="删除" className="rounded p-1.5 text-rose-500 hover:bg-rose-500/10" onClick={() => void deleteFiles([file])}><TrashIcon /></button>
                </div>
              </div>
            )) : (
              <div className="flex h-full min-h-48 items-center justify-center text-xs text-dim">没有匹配的文件</div>
            )}
          </div>
        </main>
      </div>
      {busy && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--overlay)]"><span className="rounded-md border border-edge bg-panel px-4 py-2 text-xs text-soft">正在处理…</span></div>}
    </div>
  )
}
