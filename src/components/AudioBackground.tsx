import { useEffect, useRef } from 'react'
import { getAnalyser, wireAudioElement } from '../media/audioAnalyzer'
import { getPlayerAudioElement, usePlayerStore } from '../store/playerStore'

const BAR_COUNT = 64

interface Bokeh {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  phase: number
  speed: number
}

function drawCoverFit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void {
  const ir = img.width / img.height
  const r = w / h
  let sw: number
  let sh: number
  let sx: number
  let sy: number
  if (ir > r) {
    sh = img.height
    sw = sh * r
    sx = (img.width - sw) / 2
    sy = 0
  } else {
    sw = img.width
    sh = sw / r
    sx = 0
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
}

/** 更新柱状图数值：上升快、回落慢,并对幅度做感知曲线提升,让律动更明显 */
function updateBarValues(
  values: Float32Array,
  freqs: Uint8Array | null,
  playing: boolean,
  dt: number,
): void {
  const bars = values.length
  for (let i = 0; i < bars; i++) {
    let target = 0
    if (playing && freqs && freqs.length > 0) {
      const bin = Math.floor((i / bars) * (freqs.length * 0.72))
      // 感知曲线:中小幅度频段的可见度更高
      target = Math.pow(freqs[bin] / 255, 0.72)
    }
    // 上升快、回落也快:柱体紧跟频谱,不残留影
    const k = target > values[i] ? 12 : 10
    const next = values[i] + (target - values[i]) * (1 - Math.exp(-dt * k))
    values[i] = next < 0.004 ? 0 : next
  }
}

/**
 * 在水面线上画一排发光的柱状频谱条。正像与倒影共用同一几何（baseY 即水面线），
 * glow=true 时在柱体后加一圈柔光。
 */
function drawBarStrokes(
  ctx: CanvasRenderingContext2D,
  baseY: number,
  values: Float32Array,
  barW: number,
  gap: number,
  maxH: number,
  hue: number,
  glow: boolean,
  offsetX = 0,
): void {
  const bars = values.length
  ctx.lineCap = 'round'
  for (let i = 0; i < bars; i++) {
    const v = values[i]
    if (v <= 0.002) continue
    const bh = Math.max(2, maxH * v)
    const x = offsetX + i * (barW + gap) + gap / 2 + barW / 2
    const y0 = baseY - bh
    const y1 = baseY - barW / 2
    if (glow) {
      ctx.strokeStyle = `hsla(${hue} 95% 64% / ${0.1 + v * 0.18})`
      ctx.lineWidth = barW + 3
      ctx.beginPath()
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
      ctx.stroke()
    }
    const grad = ctx.createLinearGradient(0, y0, 0, y1)
    grad.addColorStop(0, `hsla(${hue} 92% 74% / ${0.3 + v * 0.4})`)
    grad.addColorStop(1, `hsla(${hue} 90% 62% / ${0.82 + v * 0.18})`)
    ctx.strokeStyle = grad
    ctx.lineWidth = barW
    ctx.beginPath()
    ctx.moveTo(x, y0)
    ctx.lineTo(x, y1)
    ctx.stroke()
  }
}

/**
 * 沉浸式播放器背景：上半屏是专辑氛围图，水面上排开一排随音乐跳动的柱状频谱条；
 * 下半屏是它们的水中倒影，倒影随正弦波与扩散的涟漪环逐行扭曲，模拟真实水面。
 */
export function AudioBackground({
  coverUrl,
  playing,
  hue,
  tintRgb,
}: {
  coverUrl?: string
  playing: boolean
  hue: number
  tintRgb?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const coverRef = useRef<HTMLImageElement | null>(null)
  const sceneRef = useRef<HTMLCanvasElement | null>(null)
  const bokehRef = useRef<Bokeh[]>([])
  const playingRef = useRef(playing)
  playingRef.current = playing
  const hueRef = useRef(hue)
  hueRef.current = hue
  // 背景图主色 RGB,用于水面着色(随封面轮换更新)
  const tintRef = useRef(tintRgb)
  tintRef.current = tintRgb
  // 封面轮换时的交叉淡入:from 为上一张封面,start 为切换起始时间
  const transitionRef = useRef<{ from: HTMLImageElement | null; start: number }>({ from: null, start: 0 })

  useEffect(() => {
    let alive = true
    if (!coverUrl) {
      coverRef.current = null
      transitionRef.current = { from: null, start: 0 }
      sceneRef.current = null
      return
    }
    const img = new Image()
    img.src = coverUrl
    const prev = coverRef.current
    img.onload = () => {
      if (!alive) return
      if (prev && prev !== img) {
        transitionRef.current = { from: prev, start: performance.now() }
      }
      coverRef.current = img
    }
    return () => {
      alive = false
    }
  }, [coverUrl])

  // 把正在播放的音频元素接入分析器（全局元素 + 可能的画布节点元素）
  useEffect(() => {
    const global = getPlayerAudioElement()
    wireAudioElement(global)
    const external = usePlayerStore.getState().external?.element
    if (external && external !== global) wireAudioElement(external)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let last = performance.now()
    const values = new Float32Array(BAR_COUNT)

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.floor(canvas.clientWidth * dpr)
      canvas.height = Math.floor(canvas.clientHeight * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const initBokeh = () => {
      const list: Bokeh[] = []
      const count = 26
      for (let i = 0; i < count; i++) {
        list.push({
          x: Math.random(),
          y: Math.random(),
          r: 0.6 + Math.random() * 2.4,
          vx: (Math.random() - 0.5) * 0.00005,
          vy: -(0.00003 + Math.random() * 0.00008),
          phase: Math.random() * Math.PI * 2,
          speed: 0.2 + Math.random() * 0.6,
        })
      }
      bokehRef.current = list
    }
    initBokeh()

    const render = (now: number) => {
      const w = canvas.width
      const h = canvas.height
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#030509'
      ctx.fillRect(0, 0, w, h)
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(render)
        return
      }
      // 视口裁剪:任何光晕/光斑/柱体都不允许超出视口宽度
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      ctx.clip()
      const waterY = Math.floor(h * 0.58)
      const regionH = Math.max(1, h - waterY)
      let sc = sceneRef.current
      if (!sc) {
        sc = document.createElement('canvas')
        sceneRef.current = sc
      }

      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const time = now / 1000
      const playing = playingRef.current
      const hue = hueRef.current

      const node = getAnalyser()
      const freqs = playing && node ? new Uint8Array(node.frequencyBinCount) : null
      if (freqs && node) node.getByteFrequencyData(freqs)
      let level = 0
      if (freqs) {
        let sum = 0
        for (let i = 0; i < freqs.length; i++) sum += freqs[i]
        level = sum / freqs.length / 255
      }

      // 柱状图几何（正像与倒影共用）;两侧留边距,不贴视口边缘
      const barMargin = Math.round(Math.min(w * 0.02, 18))
      const innerW = Math.max(0, w - barMargin * 2)
      const barW = Math.max(2, (innerW / BAR_COUNT) * 0.62)
      const gap = Math.max(1, (innerW - barW * BAR_COUNT) / (BAR_COUNT - 1))
      const maxH = Math.min(h * 0.2, waterY * 0.42)
      // 柱体下移、底部没入水面,由水面渐变遮住下缘,初始位置更自然
      const barSink = Math.max(4, Math.round(maxH * 0.12))
      updateBarValues(values, freqs, playing, dt)

      // 场景图左右各留 margin 余量：倒影被水波横向推挤时两侧不露黑边
      const margin = Math.round(Math.min(w, h) * 0.12)
      const scW = w + margin * 2
      // 场景高度额外包含没入水面的柱体下缘,倒影才能与柱体底部相连
      const sceneH = waterY + barSink
      if (sc.width !== scW || sc.height !== sceneH) {
        sc.width = scW
        sc.height = sceneH
      }
      const sctx = sc.getContext('2d')
      if (sctx) {
        sctx.clearRect(0, 0, scW, sceneH)
        const cover = coverRef.current
        if (cover && cover.width) {
          drawCoverFit(sctx, cover, scW, sceneH)
          // 轮换时旧封面 0.9s 渐隐,新封面在其下渐显
          const tr = transitionRef.current
          if (tr.from && tr.from !== cover) {
            const fade = Math.min(1, (now - tr.start) / 900)
            sctx.globalAlpha = 1 - fade
            drawCoverFit(sctx, tr.from, scW, sceneH)
            sctx.globalAlpha = 1
            if (fade >= 1) transitionRef.current = { from: null, start: 0 }
          }
        } else {
          const g = sctx.createLinearGradient(0, 0, 0, sceneH)
          g.addColorStop(0, `hsl(${hue} 45% 9%)`)
          g.addColorStop(1, `hsl(${hue} 55% 13%)`)
          sctx.fillStyle = g
          sctx.fillRect(0, 0, scW, sceneH)
        }
        // 与亮色正像柱体保持同一横向位置(裁剪后 offset 为 barMargin)
        drawBarStrokes(sctx, sceneH, values, barW, gap, maxH, hue, false, margin + barMargin)
      }

      // 上半屏氛围图（压暗保证前景可读 + 主色光晕）
      ctx.globalAlpha = 1
      ctx.drawImage(sc, margin, 0, w, waterY, 0, 0, w, waterY)
      ctx.fillStyle = 'rgba(2,5,10,0.62)'
      ctx.fillRect(0, 0, w, waterY)
      const wash = ctx.createLinearGradient(0, 0, 0, waterY)
      wash.addColorStop(0, `hsla(${hue} 80% 55% / 0.16)`)
      wash.addColorStop(0.5, `hsla(${hue} 70% 50% / 0.05)`)
      wash.addColorStop(1, 'hsla(0 0% 0% / 0)')
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, w, waterY)

      // 漂浮光斑
      ctx.globalCompositeOperation = 'lighter'
      for (const p of bokehRef.current) {
        p.x += p.vx
        p.y += p.vy
        if (p.y < -0.08) {
          p.y = 1.08
          p.x = Math.random()
        }
        if (p.x < -0.1) p.x = 1.1
        else if (p.x > 1.1) p.x = -0.1
        const bx = p.x * w
        const by = p.y * waterY
        // 光斑随能量放大更明显,半径封顶不越出视口
        const br = Math.min(p.r * dpr * (1 + level * 2.6), w * 0.5)
        const pulse = 0.55 + 0.45 * Math.sin(time * p.speed + p.phase)
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br)
        bg.addColorStop(0, `hsla(${hue} 85% 72% / ${0.045 * pulse})`)
        bg.addColorStop(1, `hsla(${hue} 85% 72% / 0)`)
        ctx.fillStyle = bg
        ctx.fillRect(bx - br, by - br, br * 2, br * 2)
      }
      ctx.globalCompositeOperation = 'source-over'

      // 亮色柱状图（正像，压暗之上重新提亮）;柱体下移没入水面,下缘由水面渐变遮盖
      drawBarStrokes(ctx, waterY + barSink, values, barW, gap, maxH, hue, true, barMargin)

      // 水中倒影：逐扫描线镜像场景图，正弦波 + 涟漪环只做横向位移模拟水面扭曲
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, waterY, w, regionH)
      ctx.clip()

      const lineStep = Math.max(2, Math.round(dpr * 2))
      // 镜像只覆盖水面以上的可见场景:水线处采样场景的水线行,
      // 倒影从柱体在水线处的截面继续向下,与水面上的柱体截面严格对齐
      const mirrorH = waterY
      // 水波纹强度恒定,不随音乐能量变化(播放/暂停只切换动静状态)
      const baseAmp = playing ? 7 : 2.5
      const rings: { d: number; sigma: number; amp: number }[] = []
      if (playing) {
        for (let i = 0; i < 2; i++) {
          const speed = 0.16 + i * 0.09
          const d = ((time * speed + i * 0.5) % 1) * regionH
          rings.push({
            d,
            sigma: regionH * 0.055,
            amp: Math.min(w, h) * 0.014 * 1.2,
          })
        }
      }
      // 水中倒影：只做左右(横向)扭曲,不做纵向位移,保证倒影与柱体底部相连
      for (let y = waterY; y < h; y += lineStep) {
        const t = (y - waterY) / regionH
        const wob = Math.sin(y * 0.011 + time * 1.4) + 0.5 * Math.sin(y * 0.029 - time * 2.1)
        let off = wob * baseAmp
        for (const ring of rings) {
          const dist = y - waterY - ring.d
          const gauss = Math.exp(-(dist * dist) / (2 * ring.sigma * ring.sigma))
          off += Math.sin(dist * 0.11 - time * 6.5) * ring.amp * gauss
        }
        // 位移钳制在余量内：采样永远落在场景图范围内，两侧不露黑边
        off = Math.max(-margin, Math.min(margin, off))
        const sliceH = (mirrorH * lineStep) / regionH
        // 镜像采样上移一个切片,保证每行都落在场景图内部,水线处无缝相连
        const srcY = Math.max(0, mirrorH * (1 - t) - sliceH)
        ctx.drawImage(sc, margin + off, srcY, w, sliceH + 0.5, 0, y, w, lineStep + 0.5)
      }

      // 水面透明渐变（越深越暗，倒影渐隐）;有背景图时用其主色着色
      const fade = ctx.createLinearGradient(0, waterY, 0, h)
      if (tintRef.current) {
        fade.addColorStop(0, `rgba(${tintRef.current}, 0.22)`)
      } else {
        fade.addColorStop(0, `hsla(${hue} 45% 16% / 0.28)`)
      }
      fade.addColorStop(1, 'rgba(2,4,9,0.85)')
      ctx.fillStyle = fade
      ctx.fillRect(0, waterY, w, regionH)

      // 流动高光条（播放时随能量增强）
      if (playing) {
        ctx.globalCompositeOperation = 'lighter'
        const bars = 14
        for (let b = 0; b < bars; b++) {
          const yy = waterY + (b / bars) * regionH + Math.sin(time * 1.2 + b) * regionH * 0.03
          const alpha = 0.03 + level * 0.1
          const grad = ctx.createLinearGradient(0, yy, 0, yy + 2 * dpr)
          grad.addColorStop(0, `hsla(${hue} 90% 70% / ${alpha})`)
          grad.addColorStop(1, `hsla(${hue} 90% 70% / 0)`)
          ctx.fillStyle = grad
          ctx.fillRect(0, yy + Math.sin(time * 2 + b * 2) * 2 * dpr, w, 3 * dpr)
        }
        ctx.globalCompositeOperation = 'source-over'
      }
      ctx.restore()

      // 水线高光
      const lineH = Math.max(2, dpr * 6)
      const lineGrad = ctx.createLinearGradient(0, waterY, 0, waterY + lineH)
      lineGrad.addColorStop(0, `hsla(${hue} 85% 78% / 0.5)`)
      lineGrad.addColorStop(1, `hsla(${hue} 85% 78% / 0)`)
      ctx.fillStyle = lineGrad
      ctx.fillRect(0, waterY, w, lineH)

      // 暗角
      const vg = ctx.createRadialGradient(w / 2, h * 0.4, Math.min(w, h) * 0.36, w / 2, h * 0.5, Math.max(w, h) * 0.72)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, 'rgba(0,0,0,0.5)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)

      ctx.restore()

      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}
