import { useState, type FormEvent } from 'react'
import { useLanStore } from '../store/lanStore'
import { lanConnect, lanDisconnect } from '../sync/lanClient'
import { LanIcon } from '../canvas/nodes/Icons'

const inputCls =
  'w-full rounded-lg border border-edge2 bg-panel2 px-3 py-1.5 text-sm text-main outline-none placeholder:text-dim focus:border-sky-500'

const STATUS_CLS: Record<string, string> = {
  idle: 'bg-slate-500',
  connecting: 'bg-amber-500',
  connected: 'bg-emerald-500',
  error: 'bg-rose-500',
}

export function LanPanel() {
  const status = useLanStore((s) => s.status)
  const name = useLanStore((s) => s.name)
  const selfId = useLanStore((s) => s.selfId)
  const users = useLanStore((s) => s.users)
  const followId = useLanStore((s) => s.followId)
  const setFollowId = useLanStore((s) => s.setFollowId)
  const [open, setOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('ws://192.168.1.100:8790')
  const [nameDraft, setNameDraft] = useState('')

  const connected = status === 'connected'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (connected) {
      lanDisconnect()
      return
    }
    const u = urlDraft.trim()
    if (!u) return
    lanConnect(u, nameDraft.trim() || `设备-${Math.random().toString(36).slice(2, 6)}`)
  }

  const toggleFollow = (id: string) => {
    if (followId === id) {
      setFollowId(null)
      useLanStore.getState().clearRemoteViewport()
    } else {
      setFollowId(id)
    }
  }

  const others = users.filter((u) => u.id !== selfId)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="局域网协作"
        className={`relative rounded-md border p-1.5 transition-colors hover:bg-hover ${
          connected ? 'border-emerald-500/60 text-emerald-500' : 'border-edge2 text-soft hover:text-main'
        }`}
      >
        <LanIcon />
        {connected && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-edge bg-panel p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-main">
              <span className={`h-2 w-2 rounded-full ${STATUS_CLS[status]}`} />
              局域网协作
            </span>
            <span className="text-xs text-dim">{status === 'connected' ? '已连接' : status === 'connecting' ? '连接中…' : status === 'error' ? '连接失败' : '未连接'}</span>
          </div>

          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="ws://192.168.1.100:8790"
              className={inputCls}
              disabled={connected}
            />
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="你的昵称（默认自动生成）"
              className={inputCls}
              disabled={connected}
            />
            <button
              type="submit"
              className={`w-full rounded-lg py-1.5 text-sm font-medium text-white transition-colors ${
                connected ? 'bg-rose-500 hover:bg-rose-400' : 'bg-sky-600 hover:bg-sky-500'
              }`}
            >
              {connected ? '断开连接' : '连接'}
            </button>
          </form>

          <div className="mt-4">
            <div className="mb-1.5 text-xs text-dim">在线用户（{others.length + 1}）</div>
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {selfId && (
                <li className="flex items-center justify-between rounded-md bg-hover/50 px-2.5 py-1.5">
                  <span className="truncate text-sm text-soft">
                    我（{name || '设备'}）
                  </span>
                </li>
              )}
              {others.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 hover:bg-hover">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-soft">{u.name}</div>
                    <div className="truncate text-xs text-dim">{u.ip || '局域网设备'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFollow(u.id)}
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                      followId === u.id
                        ? 'border-sky-500 bg-sky-500/15 text-sky-400'
                        : 'border-edge2 text-soft hover:bg-hover'
                    }`}
                  >
                    {followId === u.id ? '跟随中' : '跟随'}
                  </button>
                </li>
              ))}
              {!connected && <li className="px-2.5 py-1.5 text-xs text-dim">尚未连接，输入中继地址加入协作</li>}
            </ul>
          </div>

          <p className="mt-3 border-t border-edge pt-2.5 text-[11px] leading-relaxed text-dim">
            在其他机器执行 <code className="rounded bg-hover px-1">npm run lan</code> 启动中继服务器，输入它的
            <code className="rounded bg-hover px-1">ws://IP:8790</code> 即可。
            <br />
            素材与画布操作将实时同步到所有连接设备。
          </p>
        </div>
      )}
    </div>
  )
}
