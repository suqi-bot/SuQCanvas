import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStoreApi,
  type OnNodeDrag,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'
import type { ToolMode } from '../store/uiStore'
import { useSettingsStore } from '../store/settingsStore'
import { useLanStore } from '../store/lanStore'
import {
  createHeadingNode,
  createShapeNode,
  createStickyNode,
  createTextNode,
  importFiles,
} from '../io/fileLoader'
import type { HeadingLevel, ShapeType, StickyColor, SuqNode } from '../types'
import { DEFAULT_EDGE_STYLE } from '../types'
import { mediaNodeTypes } from './nodes/nodeTypes'
import { styledEdgeTypes } from './edges/edgeTypes'
import { InspectorPanel } from '../components/InspectorPanel'
import { isNodeLockedByOther, sendLanCursor, setLanEditing, clearLanEditing } from '../sync/lanClient'
import { writeSelectionToSystemClipboard } from './clipboard'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8

function BoardInner() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const { screenToFlowPosition, flowToScreenPosition, setViewport: rfSetViewport, fitView, zoomIn, zoomOut, setCenter, getZoom } =
    useReactFlow()
  const storeApi = useStoreApi()
  const [dragging, setDragging] = useState(false)
  const tool = useUiStore((s) => s.tool)
  const setTool = useUiStore((s) => s.setTool)
  const tempPanRef = useRef<ToolMode | null>(null)

  const projectId = useProjectStore((s) => s.projectId)
  const theme = useSettingsStore((s) => s.theme)
  const isLight = theme === 'light'
  const cursors = useLanStore((s) => s.cursors)
  const selfId = useLanStore((s) => s.selfId)
  const editing = useLanStore((s) => s.editing)
  const lockedNodeIds = useMemo(
    () => new Set(Object.values(editing).filter((item) => item.userId !== selfId).map((item) => item.nodeId)),
    [editing, selfId],
  )
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes.filter((change) => !('id' in change) || !lockedNodeIds.has(change.id)))
    },
    [lockedNodeIds, onNodesChange],
  )
  const lockedNodes = useMemo(
    () => nodes.map((node) => (lockedNodeIds.has(node.id) ? { ...node, draggable: false, selectable: false } : node)),
    [nodes, lockedNodeIds],
  )
  const onNodeDragStart = useCallback<OnNodeDrag<SuqNode>>((_event, node) => {
    if (isNodeLockedByOther(node.id)) return
    setLanEditing(node.id, node.data?.label ?? '元素')
  }, [])
  const onNodeDragStop = useCallback<OnNodeDrag<SuqNode>>(() => {
    clearLanEditing()
  }, [])
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    sendLanCursor(p.x, p.y)
  }, [screenToFlowPosition])

  useEffect(() => {
    const vp = useCanvasStore.getState().viewport
    rfSetViewport({ x: vp.x, y: vp.y, zoom: vp.zoom }, { duration: 0 })
  }, [projectId, rfSetViewport])

  // 局域网跟随视图：应用远端视口
  useEffect(() => {
    const unsub = useLanStore.subscribe((state, prev) => {
      if (!state.remoteViewport || state.remoteViewport === prev.remoteViewport) return
      const vp = state.remoteViewport
      rfSetViewport({ x: vp.x, y: vp.y, zoom: vp.zoom }, { duration: 150 })
      useCanvasStore.getState().setViewport(vp)
    })
    return unsub
  }, [rfSetViewport])

  useEffect(() => {
    const isTypingTarget = () => {
      const t = document.activeElement
      return (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      )
    }
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget()) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useCanvasStore.getState().redo()
        else useCanvasStore.getState().undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useCanvasStore.getState().redo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const selected = useCanvasStore.getState().nodes.filter((n) => n.selected)
        for (const n of selected) {
          useCanvasStore.getState().duplicateNode(n.id)
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        const selected = useCanvasStore.getState().nodes.filter((n) => n.selected)
        useCanvasStore.getState().copySelected()
        void writeSelectionToSystemClipboard(selected)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        useCanvasStore.getState().pasteClipboard()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const all = useCanvasStore.getState().nodes
        if (all.length > 0) {
          useCanvasStore.getState().onNodesChange(
            all.map((n) => ({ id: n.id, type: 'select', selected: true })),
          )
        }
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        void fitView({ padding: 0.15, duration: 250 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView])

  // 工具切换快捷键：V 选择 / C 连线 / H 拖动；按住空格临时平移
  useEffect(() => {
    const isTypingTarget = () => {
      const t = document.activeElement
      return (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget()) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'v') {
        e.preventDefault()
        setTool('select')
      } else if (k === 'c') {
        e.preventDefault()
        setTool('connect')
      } else if (k === 'h') {
        e.preventDefault()
        setTool('drag')
      } else if (e.key === ' ' && tempPanRef.current === null) {
        e.preventDefault()
        tempPanRef.current = useUiStore.getState().tool
        setTool('drag')
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || tempPanRef.current === null) return
      e.preventDefault()
      setTool(tempPanRef.current)
      tempPanRef.current = null
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [setTool])

  const nodeTypes = useMemo<NodeTypes>(() => mediaNodeTypes, [])
  const edgeTypes = useMemo(() => styledEdgeTypes, [])
  const nodeColor = useCallback(
    (n: { data?: { borderColor?: string } }) =>
      n.data?.borderColor ?? (isLight ? '#475569' : '#94a3b8'),
    [isLight],
  )

  const centerPosition = useCallback(() => {
    return screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
  }, [screenToFlowPosition])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      setDragging(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      e.preventDefault()
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      void importFiles(files, pos)
    },
    [screenToFlowPosition],
  )

  const onPaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.react-flow__node')) return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      useCanvasStore.getState().addNodes([createTextNode(pos, true)])
    },
    [screenToFlowPosition],
  )

  useEffect(() => {
    const onAddNode = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {}
      const pos = centerPosition()
      const store = useCanvasStore.getState()
      switch (detail.kind) {
        case 'heading':
          store.addNodes([createHeadingNode(pos, (detail.level as HeadingLevel) ?? 1, true)])
          break
        case 'sticky':
          store.addNodes([createStickyNode(pos, (detail.color as StickyColor) ?? 'yellow', true)])
          break
        case 'shape':
          store.addNodes([createShapeNode(pos, (detail.shape as ShapeType) ?? 'rect', true)])
          break
        default:
          store.addNodes([createTextNode(pos, true)])
      }
    }
    const onView = (e: Event) => {
      const { action } = (e as CustomEvent).detail ?? {}
      if (action === 'fit') {
        void fitView({ padding: 0.15, duration: 250 })
      } else if (action === 'zoom-in') {
        zoomIn({ duration: 200 })
      } else if (action === 'zoom-out') {
        zoomOut({ duration: 200 })
      } else if (action === 'reset') {
        const c = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        setCenter(c.x, c.y, { zoom: 1, duration: 200 })
      }
    }
    const onFocusNode = (e: Event) => {
      const nodeId = String((e as CustomEvent).detail?.nodeId ?? '')
      const store = useCanvasStore.getState()
      const node = store.nodes.find((item) => item.id === nodeId)
      if (!node) return
      if (!isNodeLockedByOther(nodeId)) {
        store.onNodesChange(
          store.nodes.map((item) => ({
            id: item.id,
            type: 'select' as const,
            selected: item.id === nodeId,
          })),
        )
      }
      const width = node.measured?.width ?? node.width ?? 240
      const height = node.measured?.height ?? node.height ?? 160
      setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: Math.min(1.5, Math.max(0.8, getZoom())),
        duration: 350,
      })
    }
    window.addEventListener('sq:add-node', onAddNode)
    window.addEventListener('sq:view', onView)
    window.addEventListener('sq:focus-node', onFocusNode)
    return () => {
      window.removeEventListener('sq:add-node', onAddNode)
      window.removeEventListener('sq:view', onView)
      window.removeEventListener('sq:focus-node', onFocusNode)
    }
  }, [centerPosition, fitView, getZoom, zoomIn, zoomOut, screenToFlowPosition, setCenter])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      const target = document.activeElement
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      void importFiles(files, centerPosition())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [centerPosition])

  useEffect(() => {
    return useUiStore.subscribe((state, prev) => {
      if (state.importQueue && state.importQueue !== prev.importQueue) {
        const item = useUiStore.getState().consumeImport()
        if (!item) return
        const pos = item.atCenter ? centerPosition() : { x: 0, y: 0 }
        void importFiles(item.files, pos)
      }
    })
  }, [centerPosition])

  return (
    <ReactFlow
      nodes={lockedNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      isValidConnection={(c) => c.source !== c.target}
      deleteKeyCode={['Backspace', 'Delete']}
      connectionLineType={ConnectionLineType.Bezier}
      connectionLineStyle={{ stroke: DEFAULT_EDGE_STYLE.stroke, strokeWidth: 2 }}
      onMoveEnd={(_e, viewport) => setViewport(viewport)}
      onDoubleClick={onPaneDoubleClick}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      panOnDrag={tool === 'drag' ? true : [1]}
      selectionOnDrag={tool === 'select'}
      nodesDraggable={tool === 'select'}
      elementsSelectable={tool !== 'drag'}
      elevateNodesOnSelect={false}
      nodesConnectable={tool !== 'drag'}
      connectOnClick={tool !== 'drag'}
      connectionRadius={tool === 'connect' ? 300 : 20}
      onPaneClick={() => storeApi.setState({ connectionClickStartHandle: null })}
      selectionMode={SelectionMode.Partial}
      zoomOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseMove={onMouseMove}
      colorMode={theme}
      proOptions={{ hideAttribution: false }}
className={`${dragging ? 'sq-drag-active' : ''} ${
  tool === 'select' ? 'sq-select-mode' : ''
} ${tool === 'connect' ? 'sq-connect-mode' : ''} ${
  tool === 'drag' ? 'sq-drag-mode' : ''
}`}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={2}
        color={isLight ? '#cbd5e1' : '#334155'}
      />
      <Controls position="bottom-right" showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={nodeColor}
        maskColor={isLight ? 'rgba(241, 245, 249, 0.72)' : 'rgba(2, 6, 23, 0.7)'}
        bgColor={isLight ? '#f8fafc' : '#0f172a'}
      />
      {Object.values(cursors).filter((c) => c.userId !== selfId).map((cursor) => {
        const p = flowToScreenPosition({ x: cursor.x, y: cursor.y })
        return (
          <div key={cursor.userId} className="pointer-events-none absolute z-40" style={{ left: p.x, top: p.y }}>
            <div className="relative -translate-x-1 -translate-y-1">
              <div
                className="h-0 w-0 border-b-[12px] border-l-[5px] border-r-[5px] border-l-transparent border-r-transparent drop-shadow"
                style={{ borderBottomColor: cursor.color }}
              />
              <span
                className="absolute left-2 top-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] text-white shadow"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.name}
              </span>
            </div>
          </div>
        )
      })}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-sky-400/70 bg-sky-500/10">
          <span className="rounded-lg bg-[var(--panel)] px-4 py-2 text-sm text-[var(--accenttext)]">
            松开鼠标，将文件放置到画布
          </span>
        </div>
      )}
    </ReactFlow>
  )
}

function EmptyHint() {
  const hasNodes = useCanvasStore((s) => s.nodes.length > 0)
  if (hasNodes) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="rounded-2xl border border-edge bg-panel/90 px-8 py-6 text-center">
        <div className="text-sm text-soft">画布是空的</div>
        <div className="mt-2 text-xs leading-relaxed text-dim">
          拖入图片 / 视频 / 音频 / PDF / 文档文件
          <br />
          或双击空白处添加文本
          <br />
          <span className="text-faint">
            滚轮缩放 · V 选择 · C 连线 · H 拖动 · 空格临时平移
          </span>
        </div>
      </div>
    </div>
  )
}

export function CanvasBoard() {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <div className="relative h-full w-full">
          <BoardInner />
          <EmptyHint />
          <InspectorPanel />
        </div>
      </ReactFlowProvider>
    </div>
  )
}
