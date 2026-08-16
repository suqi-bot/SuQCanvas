import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useProjectStore, type SaveStatus } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import { useCanvasStore, type AlignMode } from '../store/canvasStore'
import { exportCurrentProject } from '../io/importExport'
import { LanPanel } from './LanPanel'
import { STICKY_COLORS } from '../types'
import {
  AlignBottomIcon,
  AlignCenterHIcon,
  AlignCenterVIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  DistributeHIcon,
  DistributeVIcon,
  FileIcon,
  FitIcon,
  HeadingIcon,
  HomeIcon,
  MoonIcon,
  PlusIcon,
  RedoIcon,
  ShapeIcon,
  StickyIcon,
  SunIcon,
  TextIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../canvas/nodes/Icons'

const STATUS_LABEL: Record<SaveStatus, { text: string; cls: string }> = {
  idle: { text: '编辑中…', cls: 'text-dim' },
  saving: { text: '保存中…', cls: 'text-mid' },
  saved: { text: '已保存', cls: 'text-emerald-500' },
  error: { text: '保存失败', cls: 'text-rose-500' },
}

type InsertKind = 'text' | 'heading' | 'sticky' | 'shape'

interface InsertItem {
  kind: InsertKind
  label: string
  level?: 1 | 2 | 3
  shape?: 'rect' | 'ellipse'
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactNode
}

const INSERT_ITEMS: InsertItem[] = [
  { kind: 'text', label: '文本', icon: TextIcon },
  { kind: 'heading', level: 1, label: '标题 1', icon: HeadingIcon },
  { kind: 'heading', level: 2, label: '标题 2', icon: HeadingIcon },
  { kind: 'heading', level: 3, label: '标题 3', icon: HeadingIcon },
  { kind: 'sticky', label: '便签', icon: StickyIcon },
  { kind: 'shape', shape: 'rect', label: '矩形', icon: ShapeIcon },
  { kind: 'shape', shape: 'ellipse', label: '椭圆', icon: ShapeIcon },
]

const ALIGN_BUTTONS: { mode: AlignMode; title: string; icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactNode }[] = [
  { mode: 'left', title: '左对齐', icon: AlignLeftIcon },
  { mode: 'centerH', title: '水平居中', icon: AlignCenterHIcon },
  { mode: 'right', title: '右对齐', icon: AlignRightIcon },
  { mode: 'top', title: '顶对齐', icon: AlignTopIcon },
  { mode: 'centerV', title: '垂直居中', icon: AlignCenterVIcon },
  { mode: 'bottom', title: '底对齐', icon: AlignBottomIcon },
  { mode: 'distributeH', title: '水平分布', icon: DistributeHIcon },
  { mode: 'distributeV', title: '垂直分布', icon: DistributeVIcon },
]

function dispatchAddNode(payload: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('sq:add-node', { detail: payload }))
}

function dispatchView(action: 'fit' | 'zoom-in' | 'zoom-out' | 'reset') {
  window.dispatchEvent(new CustomEvent('sq:view', { detail: { action } }))
}

const btnCls =
  'rounded-md p-1.5 text-soft transition-colors hover:bg-hover hover:text-main disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent'

export function Toolbar() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const requestImport = useUiStore((s) => s.requestImport)
  const setHomeOpen = useUiStore((s) => s.setHomeOpen)
  const projectName = useProjectStore((s) => s.projectName)
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const theme = useSettingsStore((s) => s.theme)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const zoom = useCanvasStore((s) => s.viewport.zoom)
  const canUndo = useCanvasStore((s) => s.past.length > 0)
  const canRedo = useCanvasStore((s) => s.future.length > 0)
  const undo = useCanvasStore((s) => s.undo)
  const redo = useCanvasStore((s) => s.redo)
  const alignSelected = useCanvasStore((s) => s.alignSelected)
  const selectedCount = useCanvasStore((s) => s.nodes.filter((n) => n.selected).length)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const status = STATUS_LABEL[saveStatus]

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-edge bg-panel px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        type="button"
        onClick={() => setHomeOpen(true)}
        title="返回主页面"
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold tracking-wide text-main hover:bg-hover"
      >
        <span className="text-sky-500">
          <HomeIcon />
        </span>
        SuQCanvas
      </button>

      <div className="mx-1 h-5 w-px shrink-0 bg-edge2" />

      <button
        type="button"
        onClick={() => setHomeOpen(true)}
        title="返回主页面"
        className="max-w-36 min-w-0 shrink truncate rounded-md border border-edge2 px-2.5 py-1.5 text-xs text-soft hover:bg-hover"
      >
        {projectName}
      </button>

      <button
        type="button"
        onClick={() => void exportCurrentProject()}
        title="导出当前项目为 .sqcanvas 文件"
        className="shrink-0 rounded-md border border-edge2 px-2.5 py-1.5 text-xs text-soft hover:bg-hover"
      >
        导出
      </button>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="从本地导入文件"
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
      >
        <FileIcon />
        导入
      </button>

      <div className="mx-1 h-5 w-px shrink-0 bg-edge2" />

      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title="插入元素"
          className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
            menuOpen
              ? 'border-sky-500/50 bg-hover text-main'
              : 'border-edge2 text-soft hover:bg-hover'
          }`}
        >
          <PlusIcon />
          插入
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border border-edge bg-panel p-1 shadow-2xl">
            {INSERT_ITEMS.map((item) => (
              <div key={`${item.kind}-${item.level ?? item.shape ?? ''}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-soft hover:bg-hover hover:text-main"
                  onClick={() => {
                    dispatchAddNode({
                      kind: item.kind,
                      level: item.level,
                      shape: item.shape,
                    })
                    setMenuOpen(false)
                  }}
                >
                  <span className="text-mid">
                    <item.icon />
                  </span>
                  {item.label}
                </button>
                {item.kind === 'sticky' && (
                  <div className="flex items-center gap-1.5 pl-8 pb-1.5">
                    {(Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        title={`${key}便签`}
                        className="h-3.5 w-3.5 rounded-full border"
                        style={{
                          backgroundColor: STICKY_COLORS[key].bg,
                          borderColor: STICKY_COLORS[key].border,
                        }}
                        onClick={() => {
                          dispatchAddNode({ kind: 'sticky', color: key })
                          setMenuOpen(false)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="button" title="撤销 (Ctrl+Z)" className={btnCls} disabled={!canUndo} onClick={undo}>
        <UndoIcon />
      </button>
      <button
        type="button"
        title="重做 (Ctrl+Shift+Z / Ctrl+Y)"
        className={btnCls}
        disabled={!canRedo}
        onClick={redo}
      >
        <RedoIcon />
      </button>

      {selectedCount >= 2 && (
        <>
          <div className="mx-1 h-5 w-px bg-edge2" />
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-edge2 p-0.5">
            {ALIGN_BUTTONS.map(({ mode, title, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                title={title}
                className="rounded p-0.5 text-soft hover:bg-hover hover:text-main"
                onClick={() => alignSelected(mode)}
              >
                <Icon />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex-1" />

      <LanPanel />

      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-edge2 p-0.5">
        <button type="button" title="缩小" className={btnCls} onClick={() => dispatchView('zoom-out')}>
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          title="缩放至 100%"
          className="hidden min-w-11 rounded px-1 py-0.5 text-center text-xs tabular-nums text-soft hover:bg-hover min-[1180px]:block"
          onClick={() => dispatchView('reset')}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="放大" className={btnCls} onClick={() => dispatchView('zoom-in')}>
          <ZoomInIcon />
        </button>
        <button type="button" title="适应视图 (F)" className={btnCls} onClick={() => dispatchView('fit')}>
          <FitIcon />
        </button>
      </div>

      <button
        type="button"
        onClick={toggleTheme}
        title={theme === 'dark' ? '切换到白色主题' : '切换到深色主题'}
        className="shrink-0 rounded-md border border-edge2 p-1.5 text-mid hover:bg-hover hover:text-main"
      >
        {theme === 'dark' ? <SunIcon className="text-base" /> : <MoonIcon className="text-base" />}
      </button>

      <span
        className={`hidden text-xs tabular-nums min-[1400px]:inline ${status.cls}`}
        title={status.text}
      >
        {status.text}
      </span>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) requestImport(files, true)
          e.target.value = ''
        }}
      />
    </header>
  )
}
