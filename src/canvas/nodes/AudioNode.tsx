import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { db } from '../../db/db'
import { getAssetUrl } from '../../media/blobRegistry'
import { useAssetUrl } from '../../media/useAssetUrl'
import { usePlayerStore } from '../../store/playerStore'
import { toast, useUiStore } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { AudioIcon, DownloadIcon, PauseIcon, PlayIcon } from './Icons'

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const AudioNode = memo(function AudioNode(props: NodeProps<SuqNode>) {
  const assetId = props.data.assetId
  const coverUrl = useAssetUrl(props.data.coverAssetId)
  const track = usePlayerStore((s) => s.track)
  const playing = usePlayerStore((s) => s.playing)
  const time = usePlayerStore((s) => s.time)
  const duration = usePlayerStore((s) => s.duration)

  // 节点只显示引擎当前曲目的进度；切到其他歌曲后本节点进度直接归零
  const isCurrent = track !== null && track.assetId === assetId
  const showPlaying = isCurrent && playing
  const showTime = isCurrent ? time : 0
  const showDuration = isCurrent ? duration : 0
  // 播放进度以填充遮罩铺满整个节点，仅作展示、不可拖动
  const progress = showDuration > 0 ? Math.min(showTime, showDuration) / showDuration : 0

  const toggle = () => {
    if (!assetId) return
    const player = usePlayerStore.getState()
    if (player.track?.assetId === assetId) {
      player.toggle()
    } else {
      player.play(
        { assetId, name: props.data.label ?? '音频', nodeId: props.id },
        { autoplay: true },
      )
    }
    // 文件管理器（含播放器视图）打开时不弹出悬浮窗，避免覆盖在播放器上；播放器关闭时会自动恢复
    if (!useUiStore.getState().fileManagerOpen) player.setBarVisible(true)
  }

  const download = async () => {
    if (!assetId) return
    try {
      const url = await getAssetUrl(assetId)
      const record = await db.assets.get(assetId)
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
    <MediaNodeShell
      node={props}
      alwaysShowBar
      alwaysShowCreator
      progress={progress}
    >
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--well)]">
            <AudioIcon className="h-10 w-10 text-dim/60" />
          </div>
        )}
        <div className="relative mt-auto flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={toggle}
            disabled={!assetId}
            className="nodrag flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-40"
          >
            {showPlaying ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </button>
          <span className="text-xs tabular-nums text-soft drop-shadow-sm">{fmtTime(showTime)}</span>
          <span className="flex-1" />
          <span className="text-xs tabular-nums text-soft drop-shadow-sm">{fmtTime(showDuration)}</span>
          <button
            type="button"
            onClick={() => void download()}
            disabled={!assetId}
            title="下载"
            className="nodrag rounded p-1.5 text-soft hover:bg-hover hover:text-main disabled:opacity-35"
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
    </MediaNodeShell>
  )
})
