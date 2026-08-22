// promo-bridge.js —— 注入真实应用页面的控制桥。
// 提供：
//   window.__promo.cam(...)      —— Apple 式平滑运镜（缓入缓出）
//   window.__promo.title(...)    —— 大字幕卡（淡入/淡出/缩放）
//   window.__promo.subtitle(...) —— 小标题/说明文字
//   window.__promo.blank()       —— 黑场
//   window.__promo.progress(...) —— 顶部进度条
// 全部通过 addInitScript 注入，页面加载即就绪。
;(function () {
  if (window.__promo) return

  const OVERLAY_Z = 2147483000

  function ease(t) {
    // easeInOutCubic
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3)
  }

  // ---------- 顶层 overlay 容器 ----------
  function ensureLayer() {
    let layer = document.getElementById('__promo_layer')
    if (layer) return layer
    layer = document.createElement('div')
    layer.id = '__promo_layer'
    layer.style.cssText =
      'position:fixed;inset:0;z-index:' +
      OVERLAY_Z +
      ';pointer-events:none;overflow:hidden;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;'
    document.body.appendChild(layer)
    return layer
  }

  function ensureProgress() {
    let p = document.getElementById('__promo_progress')
    if (p) return p
    p = document.createElement('div')
    p.id = '__promo_progress'
    p.style.cssText =
      'position:fixed;top:0;left:0;height:4px;width:0%;z-index:' +
      (OVERLAY_Z + 1) +
      ';background:linear-gradient(90deg,#38bdf8,#22d3ee);pointer-events:none;'
    document.body.appendChild(p)
    return p
  }

  // ---------- 运镜：直接插值 .react-flow__viewport ----------
  const cam = {
    _raf: null,
    read() {
      const vp = document.querySelector('.react-flow__viewport')
      if (!vp) return { s: 1, tx: 0, ty: 0 }
      const t = getComputedStyle(vp).transform
      const m = t.match(/matrix\(([^)]+)\)/)
      if (!m) return { s: 1, tx: 0, ty: 0 }
      const p = m[1].split(',').map(Number)
      return { s: p[0], tx: p[4], ty: p[5] }
    },
    _apply(s, tx, ty) {
      const vp = document.querySelector('.react-flow__viewport')
      if (vp) {
        vp.style.transition = 'none'
        vp.style.transform = `matrix(${s}, 0, 0, ${s}, ${tx}, ${ty})`
      }
    },
    glide(toS, toTx, toTy, duration = 1200, curve = 'out') {
      if (this._raf) cancelAnimationFrame(this._raf)
      const from = this.read()
      const fn = curve === 'linear' ? (t) => t : curve === 'inout' ? ease : easeOut
      const t0 = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - t0) / duration)
        const e = fn(t)
        this._apply(
          from.s + (toS - from.s) * e,
          from.tx + (toTx - from.tx) * e,
          from.ty + (toTy - from.ty) * e,
        )
        if (t < 1) this._raf = requestAnimationFrame(step)
        else this._raf = null
      }
      this._raf = requestAnimationFrame(step)
    },
    // 居中到某个节点：传入节点元素或坐标。用世界坐标计算，保证跨运镜准确。
    focus(nodeEl, targetScale, duration = 1200) {
      if (!nodeEl) return
      const cur = this.read()
      const r = nodeEl.getBoundingClientRect()
      // 当前屏幕坐标 -> 世界坐标（反推 viewport 变换）
      const wx = (r.left + r.width / 2 - cur.tx) / cur.s
      const wy = (r.top + r.height / 2 - cur.ty) / cur.s
      // 目标 viewport：让节点世界中心映射到屏幕中心 (960, 540)
      const tx = 960 - wx * targetScale
      const ty = 540 - wy * targetScale
      this.glide(targetScale, tx, ty, duration)
    },
  }

  // ---------- 字幕卡 ----------
  function title(text, opts = {}) {
    const layer = ensureLayer()
    const el = document.createElement('div')
    const size = opts.size || 76
    const sub = opts.sub
    el.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'opacity:0;will-change:transform,opacity;transition:opacity ' +
      (opts.fade || 600) +
      'ms cubic-bezier(0.16,1,0.3,1),transform ' +
      (opts.fade || 600) +
      'ms cubic-bezier(0.16,1,0.3,1);'
    const tEl = document.createElement('div')
    tEl.style.cssText =
      'font-size:' +
      size +
      'px;font-weight:700;letter-spacing:2px;line-height:1.2;text-align:center;color:' +
      (opts.color || '#f8fafc') +
      ';transform:translateY(28px);text-shadow:0 8px 40px rgba(0,0,0,0.45);'
    tEl.textContent = text
    el.appendChild(tEl)
    if (sub) {
      const sEl = document.createElement('div')
      sEl.style.cssText =
        'margin-top:18px;font-size:' +
        (opts.subSize || 26) +
        'px;font-weight:400;letter-spacing:6px;color:' +
        (opts.subColor || '#94a3b8') +
        ';text-align:center;transform:translateY(18px);'
      sEl.textContent = sub
      el.appendChild(sEl)
    }
    layer.appendChild(el)
    // 触发进入动画
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.opacity = '1'
        tEl.style.transform = 'translateY(0)'
        if (sub) el.lastChild.style.transform = 'translateY(0)'
      })
    })
    return {
      el,
      fade: opts.fade || 600,
      remove(ms = 600) {
        el.style.opacity = '0'
        tEl.style.transform = 'translateY(28px)'
        if (sub) el.lastChild.style.transform = 'translateY(18px)'
        setTimeout(() => el.remove(), ms)
      },
    }
  }

  // 淡入淡出式黑场（用于转场）
  function blank() {
    const layer = ensureLayer()
    const el = document.createElement('div')
    el.style.cssText =
      'position:absolute;inset:0;background:#020617;opacity:0;transition:opacity 500ms ease;'
    layer.appendChild(el)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => (el.style.opacity = '1'))
    })
    return {
      el,
      clear(ms = 500) {
        el.style.opacity = '0'
        setTimeout(() => el.remove(), ms)
      },
    }
  }

  // 顶部进度
  function progress(pct) {
    const p = ensureProgress()
    p.style.width = pct + '%'
  }

  window.__promo = { cam, title, blank, progress }
})()
