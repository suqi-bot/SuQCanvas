import { useEffect, useMemo, useState } from 'react'
import { CloseIcon, DownloadIcon, KindIcon, OpenIcon, SearchIcon, TrashIcon } from '../canvas/nodes/Icons'
import { db, type AssetRecord } from '../db/db'
import { formatBytes } from '../media/fileKind'
import { getAssetUrl, invalidateAllAssetUrls } from '../media/blobRegistry'
import { fuzzyScore } from '../search/fuzzySearch'
import { useCanvasStore } from '../store/canvasStore'
import { useLanStore } from '../store/lanStore'
import { useProjectStore } from '../store/projectStore'
import { toast, useUiStore } from '../store/uiStore'
import type { MediaKind, SuqNode } from '../types'
import { isMp3, type ManagedFile } from '../media/managedFile'
import { AudioPlayerView } from './AudioPlayer'

interface TypeGroup {
  id: string
  label: string
  kinds: MediaKind[]
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
  const [playerFlow, setPlayerFlow] = useState(false)
  const [playerPlaylistId, setPlayerPlaylistId] = useState<string | null>(null)
  const playerTarget = useUiStore((state) => state.playerTarget)

  useEffect(() => {
    if (playerTarget) {
      setPlayerAssetId(playerTarget.assetId)
      setPlayerFlow(playerTarget.flow)
      setPlayerPlaylistId(playerTarget.playlistId ?? null)
      useUiStore.setState({ playerTarget: null })
    }
  }, [playerTarget])

  // 关闭文件管理器时清空播放器入口状态：组件不卸载但渲染 null，
  // 若不清理，下次从悬浮窗/歌单徽标重新进入时会先以残留的旧歌曲挂载，
  // 导致播放器跳回上一首歌且引擎被切歌暂停
  useEffect(() => {
    if (!open) {
      setPlayerAssetId(null)
      setPlayerFlow(false)
      setPlayerPlaylistId(null)
    }
  }, [open])

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
    return (
      <AudioPlayerView
        files={files}
        initialAssetId={playerAssetId}
        initialFlow={playerFlow}
        initialPlaylistId={playerPlaylistId ?? undefined}
        onBack={() => setPlayerAssetId(null)}
        onClose={() => setOpen(false)}
      />
    )
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
      setPlayerFlow(false)
    } else if (file.kind === 'image') {
      setOpen(false)
      ui.openImageViewer(file.assetId, file.name)
    } else if (file.kind === 'psd') {
      setOpen(false)
      ui.openImageViewer(file.assetId, file.name, true)
    } else if (file.kind === 'pdf') {
      setOpen(false)
      ui.openPdfViewer(file.assetId, file.name)
    } else if (file.kind === 'video') {
      setOpen(false)
      ui.openVideoViewer(file.assetId, file.name)
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
