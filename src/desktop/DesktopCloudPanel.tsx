import { useEffect, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import type { CloudProject } from '../sync/cloudSync'
import { useProjectStore } from '../store/projectStore'
import { toast, useUiStore } from '../store/uiStore'
import { getDesktopCloudClient, isDesktopCloudConfigured } from './cloudClient'
import { downloadDesktopCloudProject, listDesktopCloudProjects } from './cloudProjects'

const inputClass = 'w-full rounded-lg border border-edge2 bg-panel2 px-3 py-2 text-sm text-main outline-none focus:border-sky-500'

export default function DesktopCloudPanel({ onDownloaded }: { onDownloaded: () => Promise<void> }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<CloudProject[]>([])
  const [reload, setReload] = useState(0)
  const busy = useProjectStore((s) => s.busy)
  const configured = isDesktopCloudConfigured()
  const signedInId = user?.id

  useEffect(() => {
    if (!configured) return
    const cloud = getDesktopCloudClient()
    let alive = true
    const { data: { subscription } } = cloud.auth.onAuthStateChange((_event, session) => {
      if (alive) { setUser(session?.user ?? null); setReady(true) }
    })
    void cloud.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return
      setUser(data.session?.user ?? null)
      if (sessionError) setError('登录状态已失效，请重新登录')
      setReady(true)
    }).catch(() => { if (alive) { setError('无法恢复登录状态，请检查网络'); setReady(true) } })
    return () => { alive = false; subscription.unsubscribe() }
  }, [configured])

  useEffect(() => {
    setProjects([])
    if (!signedInId) return
    let alive = true
    setLoading(true)
    setError('')
    void listDesktopCloudProjects().then((list) => { if (alive) setProjects(list) })
      .catch((error) => { if (alive) setError(error instanceof Error ? error.message : '读取云端项目失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [signedInId, reload])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    if (authBusy) return
    setAuthBusy(true)
    setError('')
    try {
      const { error } = await getDesktopCloudClient().auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw new Error(error.message.includes('Invalid login credentials') ? '邮箱或密码错误' : error.message)
      setPassword('')
    } catch (error) { setError(error instanceof Error ? error.message : '登录失败，请检查网络') }
    finally { setAuthBusy(false) }
  }

  const signOut = async () => {
    setAuthBusy(true)
    setError('')
    try {
      const { error } = await getDesktopCloudClient().auth.signOut({ scope: 'local' })
      if (error) throw error
      setUser(null)
      setProjects([])
    } catch (error) { setError(error instanceof Error ? error.message : '退出失败，请重试') }
    finally { setAuthBusy(false) }
  }

  const download = async (project: CloudProject) => {
    if (busy) return
    useProjectStore.getState().setBusy(true)
    setError('')
    try {
      await downloadDesktopCloudProject(project.id, (busyMessage) => useUiStore.setState({ busyMessage }))
      await onDownloaded()
      toast(`「${project.name}」已下载，可在本地离线编辑`, 'success')
    } catch (error) { setError(error instanceof Error ? error.message : '下载失败，请重试') }
    finally {
      useUiStore.setState({ busyMessage: '' })
      useProjectStore.getState().setBusy(false)
    }
  }

  if (!configured) return <div className="rounded-xl border border-edge bg-panel p-6 text-sm text-soft">
    此安装包尚未配置在线版服务，请使用连接到你的在线站点的安装包。
  </div>
  if (!ready) return <div className="py-8 text-sm text-dim">正在恢复在线账号…</div>

  return <section className="pb-8">
    <div className="mb-4 text-sm text-dim">使用在线版的邮箱和密码登录，将云端项目下载到这台电脑。编辑后点击「保存到云端」可手动写回；本地修改不会自动上传。</div>
    {error && <div role="alert" className="mb-4 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>}
    {!user ? <form onSubmit={(event) => void login(event)} className="max-w-md space-y-4 rounded-2xl border border-edge bg-panel p-6">
      <h2 className="text-base font-medium text-main">登录在线账号</h2>
      <label className="block text-xs text-soft">邮箱
        <input className={`${inputClass} mt-2`} type="email" autoComplete="username" required
          value={email} onChange={(event) => setEmail(event.target.value)} disabled={authBusy} />
      </label>
      <label className="block text-xs text-soft">密码
        <input className={`${inputClass} mt-2`} type="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.target.value)} disabled={authBusy} />
      </label>
      <button type="submit" disabled={authBusy} className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm text-white disabled:opacity-50">
        {authBusy ? '正在登录…' : '登录并查看项目'}
      </button>
    </form> : <>
      <div className="mb-4 flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm text-soft">{user.email}</span>
        <button type="button" disabled={busy || loading || authBusy} onClick={() => setReload((n) => n + 1)}
          className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft disabled:opacity-50">刷新项目</button>
        <button type="button" disabled={busy || authBusy} onClick={() => void signOut()}
          className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft disabled:opacity-50">退出在线账号</button>
      </div>
      {loading ? <div role="status" className="py-8 text-sm text-dim">正在读取云端项目…</div>
        : projects.length === 0 ? <div className="rounded-xl border border-edge p-8 text-center text-sm text-dim">
          {error ? '项目列表未能加载，请重试' : '此账号暂无云端项目'}
        </div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => <article key={project.id} className="rounded-2xl border border-edge bg-panel p-5">
            <div className="mb-2 truncate font-medium text-main" title={project.name}>{project.name}</div>
            <div className="mb-4 text-xs text-dim">{project.graph?.nodes?.length ?? 0} 个元素 · {new Date(project.updated_at).toLocaleString('zh-CN')}</div>
            <button type="button" disabled={busy || authBusy} onClick={() => void download(project)}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-50">下载到本地</button>
          </article>)}
        </div>}
    </>}
  </section>
}
