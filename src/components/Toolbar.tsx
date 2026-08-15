import { useRef } from 'react'
import { useUiStore } from '../store/uiStore'
import { useProjectStore, type SaveStatus } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import { exportCurrentProject } from '../io/importExport'
import { FileIcon, MoonIcon, SunIcon, TextIcon } from '../canvas/nodes/Icons'

const STATUS_LABEL: Record<SaveStatus, { text: string; cls: string }> = {
  idle: { text: '编辑中…', cls: 'text-dim' },
  saving: { text: '保存中…', cls: 'text-mid' },
  saved: { text: '已保存', cls: 'text-emerald-500' },
  error: { text: '保存失败', cls: 'text-rose-500' },
}

export function Toolbar() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const requestImport = useUiStore((s) => s.requestImport)
  const setManagerOpen = useUiStore((s) => s.setManagerOpen)
  const projectName = useProjectStore((s) => s.projectName)
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const theme = useSettingsStore((s) => s.theme)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)

  const status = STATUS_LABEL[saveStatus]

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel px-4">
      <span className="text-sm font-semibold tracking-wide text-main">SuQCanvas</span>

      <div className="mx-1 h-5 w-px bg-edge2" />

      <button
        type="button"
        onClick={() => setManagerOpen(true)}
        title="项目管理"
        className="max-w-52 truncate rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover"
      >
        {projectName}
      </button>

      <button
        type="button"
        onClick={() => void exportCurrentProject()}
        title="导出当前项目为 .sqcanvas 文件"
        className="rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover"
      >
        导出
      </button>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
      >
        <FileIcon />
        导入文件
      </button>

      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('sq:add-text'))
        }}
        className="flex items-center gap-1.5 rounded-md border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover"
      >
        <TextIcon />
        添加文本
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={toggleTheme}
        title={theme === 'dark' ? '切换到白色主题' : '切换到深色主题'}
        className="rounded-md border border-edge2 p-1.5 text-mid hover:bg-hover hover:text-main"
      >
        {theme === 'dark' ? <SunIcon className="text-base" /> : <MoonIcon className="text-base" />}
      </button>

      <span className={`text-xs tabular-nums ${status.cls}`}>{status.text}</span>
      <span className="text-xs text-faint">
        拖入文件 / Ctrl+V 粘贴图片 / 双击空白添加文本
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
