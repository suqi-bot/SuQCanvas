import { useEffect, useMemo, useState } from 'react'
import { AudioPlayerView } from './AudioPlayer'
import { VideoPlayerView } from './VideoPlayer'
import { db, type AssetRecord } from '../db/db'
import { collectFiles } from '../media/managedFile'
import { useCanvasStore } from '../store/canvasStore'
import { useUiStore } from '../store/uiStore'

/**
 * 专用播放器页：画布音频/视频节点双击进入。
 * 音频页复用沉浸式 AudioPlayerView（封面背景/唱片/频谱/歌词/队列），
 * 视频页复用沉浸式 VideoPlayerView（封面氛围背景 + 居中视频 + 自定义控制栏 + 视频列表）。
 */
export function PlayerPage() {
  const page = useUiStore((s) => s.playerPage)
  if (!page) return null
  return page.kind === 'audio' ? <AudioPlayerPage /> : <VideoPlayerPage />
}

function AudioPlayerPage() {
  const page = useUiStore((s) => s.playerPage)
  const close = useUiStore((s) => s.closePlayerPage)
  const nodes = useCanvasStore((s) => s.nodes)
  const [records, setRecords] = useState<Map<string, AssetRecord>>(new Map())
  const assetIds = useMemo(
    () => [...new Set(nodes.map((node) => node.data.assetId).filter((id): id is string => Boolean(id)))],
    [nodes],
  )

  useEffect(() => {
    if (page?.kind !== 'audio') return
    let alive = true
    void db.assets.bulkGet(assetIds).then((items) => {
      if (!alive) return
      setRecords(
        new Map(
          items
            .filter((item): item is AssetRecord => Boolean(item))
            .map((item) => [item.id, item]),
        ),
      )
    })
    return () => {
      alive = false
    }
  }, [assetIds, page])

  const files = useMemo(() => collectFiles(nodes, records), [nodes, records])
  if (page?.kind !== 'audio') return null
  return (
    <AudioPlayerView
      files={files}
      initialAssetId={page.assetId}
      initialFlow={page.flow}
      initialPlaylistId={page.playlistId}
      onBack={close}
      onClose={close}
    />
  )
}

function VideoPlayerPage() {
  const page = useUiStore((s) => s.playerPage)
  const close = useUiStore((s) => s.closePlayerPage)
  const nodes = useCanvasStore((s) => s.nodes)
  const [records, setRecords] = useState<Map<string, AssetRecord>>(new Map())
  const assetIds = useMemo(
    () => [...new Set(nodes.map((node) => node.data.assetId).filter((id): id is string => Boolean(id)))],
    [nodes],
  )

  useEffect(() => {
    if (page?.kind !== 'video') return
    let alive = true
    void db.assets.bulkGet(assetIds).then((items) => {
      if (!alive) return
      setRecords(
        new Map(
          items
            .filter((item): item is AssetRecord => Boolean(item))
            .map((item) => [item.id, item]),
        ),
      )
    })
    return () => {
      alive = false
    }
  }, [assetIds, page])

  const files = useMemo(() => collectFiles(nodes, records), [nodes, records])
  if (page?.kind !== 'video') return null
  return (
    <VideoPlayerView
      files={files}
      initialAssetId={page.assetId}
      onBack={close}
      onClose={close}
    />
  )
}
