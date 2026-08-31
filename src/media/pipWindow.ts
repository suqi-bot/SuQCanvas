/**
 * 桌面级迷你播放器：利用 Document Picture-in-Picture API 在浏览器窗口最小化后
 * 仍以悬浮小窗显示播放控制。仅 Chrome / Edge 116+ 支持。
 */

let pipWin: Window | null = null
let timer: ReturnType<typeof setInterval> | null = null

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>
      window: Window | null
      readonly onenter: ((ev: Event) => void) | null
    }
  }
}

export function isPipSupported(): boolean {
  return 'documentPictureInPicture' in window
}

export function isPipOpen(): boolean {
  return pipWin !== null && !pipWin.closed
}

export async function openPip(): Promise<void> {
  const api = window.documentPictureInPicture
  if (!api) return
  if (pipWin && !pipWin.closed) { pipWin.focus(); return }

  let win: Window
  try {
    win = await api.requestWindow({ width: 340, height: 90 })
  } catch { return }

  pipWin = win

  win.document.head.innerHTML = `<title>SuQCanvas 音乐</title><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#18181b;color:#e4e4e7;height:100vh;display:flex;align-items:center;padding:0 10px;overflow:hidden;user-select:none}
.w{display:flex;align-items:center;gap:6px;width:100%}
.n{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3}
.t{font-size:10px;color:#a1a1aa;font-variant-numeric:tabular-nums}
.pb{width:100%;height:3px;background:#333;border-radius:2px;margin-top:3px;cursor:pointer}
.pf{height:100%;background:#0ea5e9;border-radius:2px;width:0%;pointer-events:none}
.b{background:none;border:none;color:#a1a1aa;cursor:pointer;padding:5px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.b:hover{color:#e4e4e7;background:rgba(255,255,255,.1)}
.pp{width:34px;height:34px;background:#0ea5e9;color:#fff;border-radius:50%}
.pp:hover{background:#38bdf8}
</style>`

  win.document.body.innerHTML = `<div class="w">
<button class="b" data-a="prev" title="上一首"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button>
<button class="b pp" data-a="toggle" title="播放/暂停"></button>
<button class="b" data-a="next" title="下一首"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-10 6 8.5 6V6z" transform="scale(-1,1) translate(-24,0)"/></svg></button>
<div style="flex:1;min-width:0">
<div class="n">未播放</div>
<div class="t">0:00 / 0:00</div>
<div class="pb" data-a="seek"><div class="pf"></div></div>
</div>
<button class="b" data-a="close" title="关闭"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
</div>`

  // 控制按钮
  win.document.addEventListener('click', (e: Event) => {
    const target = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null
    if (!target) return
    const action = target.dataset.a
    const store = (window as any).__pipCtrl
    if (!store) return
    if (action === 'toggle') store.toggle()
    else if (action === 'next') store.next()
    else if (action === 'prev') store.prev()
    else if (action === 'close') win.close()
    else if (action === 'seek') {
      const bar = target as HTMLElement
      const rect = bar.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e as MouseEvent).clientX - rect.left) / rect.width)
      store.seekRatio(ratio)
    }
  })

  win.onunload = () => {
    if (timer) { clearInterval(timer); timer = null }
    pipWin = null
  }

  startSync()
}

export function closePip(): void {
  if (pipWin && !pipWin.closed) pipWin.close()
  pipWin = null
  if (timer) { clearInterval(timer); timer = null }
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

const PLAY_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const PAUSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>'

function startSync(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    if (!pipWin || pipWin.closed) {
      if (timer) { clearInterval(timer); timer = null }
      pipWin = null
      return
    }
    const doc = pipWin.document
    const store = (window as any).__pipCtrl
    if (!store) return
    const state = store.getState()
    const track = state.track as { name?: string } | null
    const nameEl = doc.querySelector('.n')
    const timeEl = doc.querySelector('.t')
    const fillEl = doc.querySelector('.pf') as HTMLElement | null
    const toggleBtn = doc.querySelector('[data-a="toggle"]')
    if (nameEl) nameEl.textContent = track?.name ?? '未播放'
    if (timeEl) timeEl.textContent = `${fmt(state.time)} / ${fmt(state.duration)}`
    if (fillEl && state.duration > 0) {
      fillEl.style.width = `${(state.time / state.duration) * 100}%`
    } else if (fillEl) {
      fillEl.style.width = '0%'
    }
    if (toggleBtn) toggleBtn.innerHTML = state.playing ? PAUSE_SVG : PLAY_SVG
  }, 500)
}
