import { useState } from 'react'
import { createPortal } from 'react-dom'
import { db } from '../db/db'
import { useProjectStore } from '../store/projectStore'
import { toast, useUiStore } from '../store/uiStore'
import { genUuid } from '../utils/uuid'
import type { CloudSaveTarget } from './saveCloudProject'

export default function DesktopCloudSaveButton({ projectId }: { projectId: string | null }) {
  const busy = useProjectStore((s) => s.busy)
  const [preparing, setPreparing] = useState(false)
  const [options, setOptions] = useState<Array<{ label: string; target: CloudSaveTarget }> | null>(null)
  const [selected, setSelected] = useState(0)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const open = async () => {
    if (!projectId || preparing || useProjectStore.getState().busy) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setPreparing(true)
    try {
      const { getDesktopCloudClient } = await import('./cloudClient')
      const { data, error } = await getDesktopCloudClient().auth.getUser()
      if (error || !data.user) throw new Error('请先在首页「在线项目」登录原在线版账号')
      const { listDesktopCloudProjects } = await import('./cloudProjects')
      const projects = await listDesktopCloudProjects()
      const local = await db.projects.get(projectId)
      if (!local) throw new Error('本地项目不存在')
      const stored = await db.desktopCloudLinks.get(projectId)
      const link = stored?.owner === data.user.id ? stored : undefined
      const next: Array<{ label: string; target: CloudSaveTarget }> = projects.map((p) => ({ label: `更新：${p.name}`, target: {
        owner: data.user!.id, projectId: p.id, updatedAt: p.updated_at, name: p.name,
      } }))
      if (link) {
        // Keep the downloaded/saved revision, even when the list already shows a newer revision.
        const index = next.findIndex((item) => item.target.projectId === link.projectId)
        if (index !== -1) next.splice(index, 1)
        next.unshift({ label: `关联项目：${link.name}`, target: {
          owner: link.owner, projectId: link.projectId, updatedAt: link.updatedAt,
          name: local.name === link.localName ? link.name : local.name,
        } })
      }
      next.splice(link ? 1 : 0, 0, { label: '另存为新云端项目', target: {
        owner: data.user.id, projectId: genUuid(), updatedAt: null, name: local.name,
      } })
      setOptions(next)
      setSelected(0)
      setName(next[0].target.name)
      setError('')
    } catch (error) { toast(error instanceof Error ? error.message : '读取云端账号失败', 'error') }
    finally { setPreparing(false) }
  }

  const save = async () => {
    if (!projectId || !options || !name.trim() || useProjectStore.getState().busy) return
    useProjectStore.getState().setBusy(true)
    setError('')
    try {
      const project = useProjectStore.getState()
      if (project.projectId === projectId && project.loaded) {
        await project.saveNow()
        if (useProjectStore.getState().saveStatus === 'error') throw new Error('本地保存失败，请重试')
      }
      const { saveDesktopCloudProject } = await import('./saveCloudProject')
      await saveDesktopCloudProject(projectId, { ...options[selected].target, name: name.trim() },
        (busyMessage) => useUiStore.setState({ busyMessage }))
      setOptions(null)
      toast(`「${name.trim()}」已保存到云端`, 'success')
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败，请检查网络') }
    finally {
      useUiStore.setState({ busyMessage: '' })
      useProjectStore.getState().setBusy(false)
    }
  }

  return <>
    <button type="button" disabled={!projectId || busy || preparing} onClick={() => void open()}
      className="shrink-0 rounded-md border border-sky-500/40 px-2 py-1.5 text-xs text-sky-500 hover:bg-hover disabled:opacity-50">
      {preparing ? '正在连接…' : '保存到云端'}
    </button>
    {options && createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !busy) setOptions(null) }}>
      <section role="dialog" aria-modal="true" aria-label="保存到云端" className="w-full max-w-lg space-y-4 rounded-xl border border-edge bg-panel p-6 text-sm text-main">
        <h2 className="font-medium">保存到云端</h2>
        <label className="block">保存位置
          <select autoFocus disabled={busy} value={selected} onChange={(event) => {
            const index = Number(event.target.value); setSelected(index); setName(options[index].target.name); setError('')
          }} className="mt-2 w-full rounded border border-edge2 bg-panel2 p-2">
            {options.map((item, index) => <option key={item.target.projectId} value={index}>{item.label}</option>)}
          </select>
        </label>
        <label className="block">云端项目名称
          <input disabled={busy} value={name} onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded border border-edge2 bg-panel2 p-2" />
        </label>
        <p className="text-xs text-dim">{options[selected].target.updatedAt === null
          ? '将在当前在线账号中新建项目。'
          : '将用本地画布及素材更新所选云端项目。如云端版本已变化，本次保存会停止，请下载最新版本核对或另存为新项目。'} 本地编辑仍会自动保存，只有点击下方按钮才会写入云端。</p>
        {error && <p role="alert" className="text-rose-500">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={() => setOptions(null)} className="rounded border border-edge2 px-4 py-2">取消</button>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void save()}
            className="rounded bg-sky-600 px-4 py-2 text-white disabled:opacity-50">{busy ? '正在保存…' : '确认保存到云端'}</button>
        </div>
      </section>
    </div>, document.body)}
  </>
}
