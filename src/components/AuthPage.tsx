import { useEffect, useState, type FormEvent } from 'react'
import { useAuthStore } from '../store/authStore'
import { isCloudConfigured } from '../sync/supabaseClient'
import { IS_LAN_BUILD } from '../buildMode'
import { getDefaultLanUrl, lanConnect } from '../sync/lanClient'
import { useLanStore } from '../store/lanStore'

const inputCls =
  'w-full rounded-lg border border-edge2 bg-panel2 px-3 py-2 text-sm text-main outline-none placeholder:text-dim focus:border-sky-500'

export function AuthPage() {
  const signIn = useAuthStore((s) => s.signIn)
  const enterGuest = useAuthStore((s) => s.enterGuest)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lanUrl, setLanUrl] = useState(getDefaultLanUrl)
  const [lanName, setLanName] = useState('')
  const [waitingForLan, setWaitingForLan] = useState(false)
  const lanStatus = useLanStore((s) => s.status)

  useEffect(() => {
    if (!waitingForLan) return
    if (lanStatus === 'connected') {
      setWaitingForLan(false)
      setBusy(false)
      enterGuest()
    } else if (lanStatus === 'error') {
      setWaitingForLan(false)
      setBusy(false)
      setError('连接失败，请检查局域网地址和中继服务')
    }
  }, [enterGuest, lanStatus, waitingForLan])

  const switchMode = (m: 'login' | 'register') => {
    setMode(m)
    setError(null)
  }

  const handleEnterLan = (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    const url = lanUrl.trim()
    const name = lanName.trim()
    if (!url || !name) {
      setError('请填写局域网地址和协作名称')
      return
    }
    setError(null)
    setBusy(true)
    setWaitingForLan(true)
    if (!lanConnect(url, name)) {
      setWaitingForLan(false)
      setBusy(false)
      setError('局域网地址无效，请检查后重试')
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (!isCloudConfigured()) {
      setError('未配置 Supabase 环境变量，无法登录')
      return
    }
    setBusy(true)
    const err = await signIn(email.trim(), password)
    setBusy(false)
    if (err) setError(err)
  }

  if (IS_LAN_BUILD) {
    return (
      <div className="flex h-full items-center justify-center bg-app px-4 text-main">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="text-2xl font-bold tracking-wide">SuQCanvas</div>
            <div className="mt-1 text-xs text-dim">连接局域网协作主机</div>
          </div>
          <form
            onSubmit={handleEnterLan}
            className="space-y-4 rounded-2xl border border-edge bg-panel p-6"
          >
            <div>
              <label className="mb-1.5 block text-xs text-soft">局域网地址</label>
              <input
                required
                autoFocus
                value={lanUrl}
                onChange={(e) => setLanUrl(e.target.value)}
                placeholder="ws://服务器IP:8790"
                autoComplete="url"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-soft">协作名称</label>
              <input
                required
                maxLength={30}
                value={lanName}
                onChange={(e) => setLanName(e.target.value)}
                placeholder="其他协作者看到的名称"
                autoComplete="nickname"
                className={inputCls}
              />
            </div>
            {error && (
              <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? '正在连接…' : '连接并进入'}
            </button>
            <p className="text-center text-[11px] leading-relaxed text-dim">
              协作名称会显示给当前项目的其他成员；连接成功后会记住本设备配置
            </p>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-app px-4 text-main">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-wide">SuQCanvas</div>
          <div className="mt-1 text-xs text-dim">无限画布 · 登录后同步你的项目</div>
        </div>
        {mode === 'login' ? (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4 rounded-2xl border border-edge bg-panel p-6"
          >
            <div>
              <label className="mb-1.5 block text-xs text-soft">邮箱</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-soft">密码</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码"
                autoComplete="current-password"
                className={inputCls}
              />
            </div>
            {error && (
              <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? '请稍候…' : '登录'}
            </button>
            <div className="text-center text-xs text-dim">
              没有账号？{' '}
              <button
                type="button"
                onClick={() => switchMode('register')}
                className="text-sky-500 hover:underline"
              >
                注册
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 rounded-2xl border border-edge bg-panel p-6">
            <div className="rounded-lg bg-amber-500/10 px-3 py-3 text-center text-xs leading-relaxed text-amber-400">
              当前无法注册，如需开通账号请联系管理员
            </div>
            <div className="text-center text-xs text-dim">
              已有账号？{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-sky-500 hover:underline"
              >
                返回登录
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
