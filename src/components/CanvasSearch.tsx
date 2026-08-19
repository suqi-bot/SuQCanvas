import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, KindIcon, SearchIcon } from '../canvas/nodes/Icons'
import { searchCanvasNodes } from '../search/fuzzySearch'
import { useCanvasStore } from '../store/canvasStore'
import type { MediaKind, SuqNode } from '../types'

const KIND_LABELS: Record<MediaKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  pdf: 'PDF',
  psd: 'PSD',
  markdown: 'Markdown',
  text: '文本',
  file: '文件',
  heading: '标题',
  sticky: '便签',
  shape: '图形',
}

const MAX_RESULTS = 60

function resultLabel(node: SuqNode): string {
  return node.data.label?.trim() || node.data.text?.trim().slice(0, 80) || KIND_LABELS[node.data.kind]
}

function focusNode(nodeId: string) {
  window.dispatchEvent(new CustomEvent('sq:focus-node', { detail: { nodeId } }))
}

export function CanvasSearch() {
  const nodes = useCanvasStore((state) => state.nodes)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320 })

  const results = useMemo(
    () => searchCanvasNodes(nodes, query).slice(0, MAX_RESULTS),
    [nodes, query],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.select()
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(360, Math.max(280, window.innerWidth - 24))
      setPosition({
        left: Math.min(rect.left, window.innerWidth - width - 12),
        top: rect.bottom + 6,
        width,
      })
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    updatePosition()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => setActiveIndex(0), [query])

  useEffect(() => {
    if (!open) return
    dropdownRef.current
      ?.querySelector<HTMLElement>('[data-search-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const choose = (node: SuqNode) => {
    focusNode(node.id)
    setOpen(false)
  }

  return (
    <div ref={anchorRef} className="relative shrink-0">
      {open ? (
        <div className="flex h-8 w-52 items-center gap-1 rounded-md border border-sky-500/60 bg-panel2 px-2 shadow-sm">
          <SearchIcon className="shrink-0 text-mid" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => results.length > 0 ? Math.min(results.length - 1, index + 1) : 0)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(0, index - 1))
              } else if (event.key === 'Enter' && results[activeIndex]) {
                event.preventDefault()
                choose(results[activeIndex])
              }
            }}
            placeholder="搜索文件或元素"
            aria-label="搜索画布"
            className="min-w-0 flex-1 bg-transparent text-xs text-main outline-none placeholder:text-dim"
          />
          <button
            type="button"
            title="关闭搜索"
            aria-label="关闭搜索"
            className="rounded p-0.5 text-dim hover:bg-hover hover:text-main"
            onClick={() => setOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
      ) : (
        <button
          type="button"
          title="搜索画布 (Ctrl+F)"
          aria-label="搜索画布"
          className="rounded-md border border-edge2 p-1.5 text-soft hover:bg-hover hover:text-main"
          onClick={() => setOpen(true)}
        >
          <SearchIcon />
        </button>
      )}

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[85] overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl"
          style={position}
        >
          <div className="flex h-8 items-center justify-between border-b border-edge px-3 text-[11px] text-dim">
            <span>{query.trim() ? '匹配结果' : '画布元素'}</span>
            <span>{results.length}{nodes.length > MAX_RESULTS && !query.trim() ? '+' : ''}</span>
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {results.length > 0 ? results.map((node, index) => (
              <button
                key={node.id}
                type="button"
                data-search-active={index === activeIndex}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${
                  index === activeIndex ? 'bg-hover text-main' : 'text-soft hover:bg-hover hover:text-main'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(node)}
              >
                <span className="shrink-0 text-mid">
                  <KindIcon kind={node.data.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs" title={resultLabel(node)}>{resultLabel(node)}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-dim">
                    {KIND_LABELS[node.data.kind]}
                    {node.data.createdByName ? ` · ${node.data.createdByName}` : ''}
                  </span>
                </span>
              </button>
            )) : (
              <div className="px-3 py-8 text-center text-xs text-dim">没有匹配的元素</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
