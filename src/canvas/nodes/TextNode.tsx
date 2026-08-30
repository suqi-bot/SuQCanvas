import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { SuqNode } from '../../types'
import { resolvePlaylistsCached } from '../../media/playlists'
import { useCanvasStore } from '../../store/canvasStore'
import { useUiStore } from '../../store/uiStore'
import { MediaNodeShell } from './MediaNodeShell'
import { FlowIcon } from './Icons'
import { buildTextStyle, V_JUSTIFY } from './textStyle'
import { setLanEditing, clearLanEditing } from '../../sync/lanClient'
import { ResizeHandles } from './ResizeHandles'

export const TextNode = memo(function TextNode(props: NodeProps<SuqNode>) {
  const { id, data, selected } = props
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  // 该文本节点是否命名了一个画布歌单(文本 → 单条出边 → 音频首节点)
  const playlistTitle = useMemo(
    () => resolvePlaylistsCached(nodes, edges).find((playlist) => playlist.titleNodeId === id) ?? null,
    [nodes, edges, id],
  )
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (data.autoEdit) {
      setEditing(true)
      updateNodeData(id, { autoEdit: false })
    }
  }, [data.autoEdit, id, updateNodeData])

  useEffect(() => {
    if (editing) {
      const ta = textareaRef.current
      ta?.focus()
      ta?.select()
    }
  }, [editing])

  useEffect(() => {
    if (editing) setLanEditing(id, data.label ?? '文本')
    else clearLanEditing()
    return () => clearLanEditing()
  }, [editing, id, data.label])

  const commit = (value: string) => {
    setEditing(false)
    updateNodeData(id, { text: value })
  }

  const textStyle = buildTextStyle(data)
  const vJustify = V_JUSTIFY[data.textAlignV ?? 'top']

  const openPlaylist = () => {
    if (!playlistTitle || playlistTitle.tracks.length === 0) return
    useUiStore
      .getState()
      .openMusicPlayer(playlistTitle.tracks[0].assetId, true, playlistTitle.id)
  }

  return (
    <MediaNodeShell node={props}>
      <div className="relative flex h-full min-h-10 flex-col p-3" style={{ justifyContent: vJustify }}>
        {playlistTitle && !editing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openPlaylist()
            }}
            className="nodrag absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-full bg-sky-500/90 px-1.5 py-0.5 text-[9px] font-medium text-white shadow hover:bg-sky-500"
            title={`歌单「${playlistTitle.name}」· ${playlistTitle.tracks.length} 首,点击播放`}
          >
            <FlowIcon className="h-2.5 w-2.5" /> 歌单
          </button>
        )}
        {editing ? (
          <textarea
            ref={textareaRef}
            defaultValue={data.text ?? ''}
            rows={Math.max(2, (data.text ?? '').split('\n').length + 2)}
            placeholder="输入文本…"
            style={textStyle}
            className="nodrag w-full resize-none bg-transparent text-sm leading-relaxed text-main outline-none placeholder:text-dim"
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') commit(e.currentTarget.value)
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit(e.currentTarget.value)
            }}
          />
        ) : (
          <div
            style={textStyle}
            className="cursor-text whitespace-pre-wrap break-words text-sm leading-relaxed text-main"
            onDoubleClick={() => setEditing(true)}
          >
            {data.text && data.text.length > 0 ? data.text : <span className="text-dim">双击编辑文本</span>}
          </div>
        )}
      </div>
      {selected && !editing && <ResizeHandles nodeId={id} />}
    </MediaNodeShell>
  )
})
