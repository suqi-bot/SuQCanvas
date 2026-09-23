import { memo, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { neteaseUrlFor, parseNeteaseTarget } from '../../media/netease'
import { useCanvasStore } from '../../store/canvasStore'
import { useNeteaseStore } from '../../store/neteaseStore'
import { toast } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { AudioIcon, OpenIcon, PauseIcon, PlayIcon } from './Icons'

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 网易云轻节点：只存歌曲 id / 标题 / 可选封面 URL，音频仍在网易云内播放。 */
export const NeteaseNode = memo(function NeteaseNode(props: NodeProps<SuqNode>) {
  const songId = typeof props.data.neteaseId === 'string' ? props.data.neteaseId : ''
  const cover = typeof props.data.neteaseCoverUrl === 'string' ? props.data.neteaseCoverUrl : ''
  const open = useNeteaseStore((s) => s.open)
  const activeSongId = useNeteaseStore((s) => s.activeSongId)
  const externalPlaying = useNeteaseStore((s) => s.externalPlaying)
  const externalTime = useNeteaseStore((s) => s.externalTime)
  const externalDuration = useNeteaseStore((s) => s.externalDuration)
  const externalProgress = useNeteaseStore((s) => s.externalProgress)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  const ref = parseNeteaseTarget(songId) ?? { type: 'home' as const }
  const numericId = ref.type === 'song' && ref.id ? ref.id : (/^\d+$/.test(songId) ? songId : '')
  const isCurrent = Boolean(numericId) && activeSongId === numericId
  const showPlaying = isCurrent && externalPlaying
  const showTime = isCurrent ? externalTime : 0
  const showDuration = isCurrent ? externalDuration : 0
  const progress = isCurrent
    ? showDuration > 0 ? Math.min(showTime, showDuration) / showDuration : externalProgress
    : 0

  const play = () => {
    if (!numericId) {
      toast('请先填写网易云歌曲 ID 或链接', 'error')
      return
    }
    void useNeteaseStore.getState().toggleSong(numericId)
  }

  const openHome = () => {
    void useNeteaseStore.getState().openPanel({ type: 'home' })
  }

  const commitLink = () => {
    const parsed = parseNeteaseTarget(draft)
    if (!parsed || (parsed.type !== 'song' && parsed.type !== 'playlist' && parsed.type !== 'album')) {
      toast('无法识别的网易云链接或 ID', 'error')
      return
    }
    const label =
      parsed.type === 'song'
        ? `网易云歌曲 ${parsed.id}`
        : parsed.type === 'playlist'
          ? `网易云歌单 ${parsed.id}`
          : `网易云专辑 ${parsed.id}`
    useCanvasStore.getState().updateNodeData(props.id, {
      neteaseId: parsed.id ?? '',
      label,
    })
    setEditing(false)
    setDraft('')
    toast('已保存网易云链接', 'success')
  }

  return (
    <MediaNodeShell node={props} alwaysShowBar alwaysShowCreator progress={progress}>
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--well)] px-3 text-center">
            <AudioIcon className="h-9 w-9 text-rose-400/70" />
            <span className="text-[10px] leading-tight text-dim">
              {songId ? `ID ${songId}` : '填写歌曲链接后播放'}
            </span>
          </div>
        )}
        <div className="absolute left-2 top-2 rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white">
          网易云
        </div>
        <div className="relative mt-auto flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={play}
            disabled={!numericId}
            title={showPlaying ? '暂停网易云播放' : isCurrent ? '继续播放' : '在网易云中播放此曲'}
            onDoubleClick={(event) => event.stopPropagation()}
            className="nodrag flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white hover:bg-rose-400 disabled:opacity-40"
          >
            {showPlaying ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </button>
          <span className="text-xs tabular-nums text-soft drop-shadow-sm">{fmtTime(showTime)}</span>
          <span className="flex-1" />
          <span className="text-xs tabular-nums text-soft drop-shadow-sm">{fmtTime(showDuration)}</span>
          <button
            type="button"
            title={open ? '面板已打开' : '打开网易云面板'}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={openHome}
            className="nodrag rounded p-1.5 text-soft hover:bg-hover hover:text-main"
          >
            <OpenIcon />
          </button>
        </div>
        {editing && (
          <div
            className="nodrag absolute inset-x-2 top-8 z-10 rounded-lg border border-edge bg-panel p-2 shadow-xl"
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitLink()
                if (event.key === 'Escape') { setEditing(false); setDraft('') }
              }}
              placeholder="歌曲 ID 或 music.163.com 链接"
              className="w-full rounded border border-edge2 bg-panel2 px-2 py-1 text-xs text-main outline-none focus:border-rose-500"
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button
                type="button"
                className="rounded px-2 py-1 text-[11px] text-soft hover:bg-hover"
                onClick={() => { setEditing(false); setDraft('') }}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded bg-rose-500 px-2 py-1 text-[11px] text-white hover:bg-rose-400"
                onClick={commitLink}
              >
                保存
              </button>
            </div>
          </div>
        )}
        {!songId && !editing && (
          <button
            type="button"
            className="nodrag absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/70"
            onClick={() => { setDraft(''); setEditing(true) }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            粘贴链接
          </button>
        )}
        {songId && (
          <button
            type="button"
            className="nodrag absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/90 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
            onClick={() => { setDraft(neteaseUrlFor(ref)); setEditing(true) }}
            onDoubleClick={(event) => event.stopPropagation()}
            title="修改链接"
          >
            改链接
          </button>
        )}
      </div>
    </MediaNodeShell>
  )
})
