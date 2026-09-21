import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLanStore } from '../store/lanStore'
import { useProjectStore } from '../store/projectStore'
import { refreshLanProjects, getDefaultLanUrl, getSavedLanConfig, lanConnect, lanDisconnect } from '../sync/lanClient'
import { recentLanServers } from '../sync/lanHistory'

const inputClass = 'mt-2 w-full rounded-lg border border-edge2 bg-panel2 px-3 py-2 text-sm text-main outline-none focus:border-sky-500 disabled:opacity-50'

/** The desktop LAN session lives in the project tab, like the online account panel. */
export function LanProjectPanel() {
  const status = useLanStore((s) => s.status)
  const name = useLanStore((s) => s.name)
  const url = useLanStore((s) => s.url)
  const busy = useProjectStore((s) => s.busy)
  const [urlDraft, setUrlDraft] = useState(() => getSavedLanConfig()?.url ?? getDefaultLanUrl())
  const [nameDraft, setNameDraft] = useState(() => getSavedLanConfig()?.name ?? '')
  const connected = status === 'connected'
  const connecting = status === 'connecting'
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState('')
  const refreshController = useRef<AbortController | null>(null)
  useEffect(() => () => refreshController.current?.abort(), [])
  useEffect(() => { if (!connected) setRefreshMessage('') }, [connected])
  const recent = recentLanServers()
  async function refresh() {
    if (refreshing) return
    const controller = new AbortController()
    refreshController.current = controller
    setRefreshing(true); setRefreshMessage('正在刷新项目…')
    try { await refreshLanProjects(controller.signal); setRefreshMessage(`已刷新 · ${new Date().toLocaleTimeString()}`) }
    catch (error) { if (!controller.signal.aborted) setRefreshMessage(error instanceof Error ? error.message : '刷新失败') }
    finally { if (!controller.signal.aborted) setRefreshing(false) }
  }

  function connect(event: FormEvent) {
    event.preventDefault()
    if (busy || connecting || !urlDraft.trim() || !nameDraft.trim()) return
    lanConnect(urlDraft.trim(), nameDraft.trim())
  }

  return <section className="mb-5" aria-label="局域网连接">
    <p className="mb-4 text-sm text-dim">填写服务器地址和协作名称，连接后可下载局域网项目到这台电脑。本地项目可手动上传到服务器，断开连接不影响本地编辑。</p>
    {status === 'error' && <p role="alert" className="mb-4 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-400">连接失败，请检查服务器地址、网络及服务是否启动后重试。</p>}
    {connected ? <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm text-soft"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" /><span className="truncate">{name}</span><span className="shrink-0 text-xs text-dim">已连接</span></div>
        <div className="mt-1 truncate text-xs text-dim" title={url}>{url}</div>
      </div>
      <button type="button" disabled={busy || refreshing} onClick={() => void refresh()} className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover disabled:opacity-50">{refreshing ? '正在刷新…' : '刷新项目'}</button>
      <button type="button" disabled={busy} onClick={lanDisconnect} className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft hover:bg-hover disabled:opacity-50">退出局域网连接</button>
    </div> : <form onSubmit={connect} className="max-w-md space-y-4 rounded-2xl border border-edge bg-panel p-6">
      <h2 className="text-base font-medium text-main">连接局域网</h2>
      {!!recent.length && <label className="block text-xs text-soft">最近连接
        <select className={inputClass} value="" disabled={busy || connecting} onChange={(e) => {
          const item = recent.find((server) => server.url === e.target.value)
          if (item) { setUrlDraft(item.url); setNameDraft(item.name) }
        }}><option value="">选择之前使用的服务器</option>{recent.map((item) => <option key={item.url} value={item.url}>{item.name} · {item.url}</option>)}</select>
      </label>}
      <label className="block text-xs text-soft">服务器地址
        <input className={inputClass} required autoComplete="url" placeholder="ws://服务器IP:8790 或 wss://域名/lan-ws" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} disabled={busy || connecting} />
      </label>
      <label className="block text-xs text-soft">协作名称
        <input className={inputClass} required autoComplete="nickname" placeholder="你的昵称" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} disabled={busy || connecting} />
      </label>
      <button type="submit" disabled={busy || connecting || !urlDraft.trim() || !nameDraft.trim()} className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-50">{connecting ? '正在连接…' : '连接并查看项目'}</button>
      {connecting && <button type="button" onClick={lanDisconnect} disabled={busy} className="w-full rounded-lg border border-edge2 px-4 py-2 text-sm text-soft disabled:opacity-50">取消连接</button>}
    </form>}
    {connected && refreshMessage && <p role="status" className="mt-3 text-xs text-mid">{refreshMessage}</p>}
  </section>
}
