import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { db } from '../../db/db'
import { getAssetUrl } from '../../media/blobRegistry'
import { useAssetUrl } from '../../media/useAssetUrl'
import { registerAudio } from '../../media/mediaCoordinator'
import { usePlayerStore } from '../../store/playerStore'
import { toast } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { DownloadIcon, MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from './Icons'
import { useCanvasStore } from '../../store/canvasStore'

// Keep mounted audio elements discoverable so a connected audio node can start
// playback without coupling nodes to one another through React props.
const audioRegistry = new Map<string, HTMLAudioElement>()

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const AudioNode = memo(function AudioNode(props: NodeProps<SuqNode>) {
  const url = useAssetUrl(props.data.assetId)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const track = usePlayerStore((s) => s.track)
  const trackPlaying = usePlayerStore((s) => s.trackPlaying)
  const trackTime = usePlayerStore((s) => s.trackTime)
  const trackDuration = usePlayerStore((s) => s.trackDuration)

  // 与全局播放器联动：播放器（或播放器悬浮栏）正在播放同一首歌时，元素展示并控制全局播放
  const linkedToTrack = track !== null && track.assetId === props.data.assetId
  const showPlaying = linkedToTrack ? trackPlaying : playing
  const showTime = linkedToTrack ? trackTime : time
  const showDuration = linkedToTrack ? trackDuration : duration

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted, url])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audioRegistry.set(props.id, audio)
    const unregister = registerAudio(audio)
    return () => {
      unregister()
      if (audioRegistry.get(props.id) === audio) audioRegistry.delete(props.id)
      const player = usePlayerStore.getState()
      if (player.external?.element === audio) player.setExternal(null)
    }
  }, [props.id, url])

  const playConnectedAudio = () => {
    const { edges, nodes } = useCanvasStore.getState()
    const next = edges
      .filter((edge) => edge.source === props.id)
      .map((edge) => nodes.find((node) => node.id === edge.target))
      .find((node) => node?.data.kind === 'audio')
    if (!next) return
    const target = audioRegistry.get(next.id)
    if (target) void target.play().catch(() => undefined)
  }

  const toggle = () => {
    if (linkedToTrack) {
      usePlayerStore.getState().toggle()
      return
    }
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  const seek = (value: number) => {
    if (linkedToTrack) {
      usePlayerStore.getState().seekTo(value)
      return
    }
    if (audioRef.current) audioRef.current.currentTime = value
    setTime(value)
  }

  const setVol = (value: number) => {
    usePlayerStore.getState().setVolume(value)
    if (audioRef.current) {
      audioRef.current.volume = value
      audioRef.current.muted = value === 0
    }
  }

  const toggleMute = () => {
    const next = !muted
    usePlayerStore.getState().setMuted(next)
    if (audioRef.current) audioRef.current.muted = next
  }

  const download = async () => {
    if (!props.data.assetId) return
    try {
      const url = await getAssetUrl(props.data.assetId)
      const record = await db.assets.get(props.data.assetId)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = record?.name ?? props.data.label ?? 'audio.mp3'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      toast('已开始下载', 'success')
    } catch {
      toast('下载失败', 'error')
    }
  }

  return (
    <MediaNodeShell node={props}>
      <div className="flex flex-col gap-2 p-3">
        {url && (
          <audio
            ref={audioRef}
            src={url}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={(e) => {
              setPlaying(true)
              if (!props.data.assetId) return
              const player = usePlayerStore.getState()
              player.setExternal({ assetId: props.data.assetId, name: props.data.label ?? '音频', element: e.currentTarget })
              player.setBarVisible(true)
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false)
              playConnectedAudio()
            }}
          />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            disabled={!url}
            className="nodrag flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-40"
          >
            {showPlaying ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </button>
          <span className="text-xs tabular-nums text-mid">{fmtTime(showTime)}</span>
          <input
            type="range"
            min={0}
            max={showDuration || 0}
            step={0.05}
            value={Math.min(showTime, showDuration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!url || !showDuration}
            className="nodrag h-1 min-w-0 flex-1 cursor-pointer accent-sky-500"
          />
          <span className="text-xs tabular-nums text-mid">{fmtTime(showDuration)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            className="nodrag text-mid hover:text-main"
            title={muted ? '取消静音' : '静音'}
          >
            {muted ? <MuteIcon /> : <VolumeIcon />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => setVol(Number(e.target.value))}
            className="nodrag h-1 w-16 cursor-pointer accent-sky-500"
          />
          <button
            type="button"
            onClick={() => void download()}
            disabled={!url}
            title="下载"
            className="nodrag ml-auto rounded p-1.5 text-mid hover:bg-hover hover:text-main disabled:opacity-35"
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
    </MediaNodeShell>
  )
})
