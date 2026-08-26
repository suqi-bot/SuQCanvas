import { useEffect, useRef } from 'react'
import { getAnalyser, wireAudioElement } from '../media/audioAnalyzer'
import { getPlayerAudioElement } from '../store/playerStore'
import waterNoiseUrl from '../../art/water.png'

const BAR_COUNT = 64
// 水面线占视口高度的比例（下移至下方 22% 处，上方便是完整背景图）
export const WATER_RATIO = 0.78
// 水面效果开关：当前先只保留「正弦波扭动 + 点光源照亮」，其余效果暂时禁用
const E_NOISE = false // 噪纹纹理（water.png）
const E_BOKEH = false // 漂浮光斑
const E_RINGS = false // 倒影涟漪环
const E_HL_BARS = false // 流动高光条
const E_VIGNETTE = false // 暗角

// 类 GLSL 水波扭动：4 个位于画面四角外侧的波源,各自径向扩散正弦,
// 波长系数/速度各不相同,叠加后产生多源流动的扭动感
const WAVE_SRC = [
  { x: -0.09, y: -0.09, k: 1.31, spd: 1.23 },
  { x: 1.11, y: 0.11, k: 1.13, spd: 1.09 },
  { x: 0.13, y: 1.13, k: 0.97, spd: 0.91 },
  { x: 1.07, y: 1.08, k: 0.83, spd: 0.79 },
]
const WAVELENGTH = 6.2

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
 * 逐行水波扭动：t 为纵向纹理坐标(0..1)，row 为行索引，
 * 平滑随机权重(插值化的 randFunc 替代)乘以 4 个波源的径向正弦之和。
 */
function waveOff(t: number, row: number, tNow: number): number {
  let acc = 0
  for (let i = 0; i < WAVE_SRC.length; i++) {
    const s = WAVE_SRC[i]
    const dx = 0.5 - s.x
    const dy = t - s.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const rand = 0.5 + 0.5 * Math.sin(row * 0.23 + i * 1.9)
    acc += rand * Math.sin(dist * s.k * WAVELENGTH - tNow * s.spd)
  }
  return acc
}

/**
 * 沉浸式播放器背景：上半屏是专辑氛围图，水面上排开一排随音乐跳动的柱状频谱条；
 * 下半屏是它们的水中倒影，倒影由多波源径向正弦逐行扭动，模拟真实水面。
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
  // 水面噪纹纹理（art/water.png）：平铺在水区,给水面补细碎波纹高光
  const noiseRef = useRef<HTMLImageElement | null>(null)
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

  // 预加载水面噪纹纹理（E_NOISE 开启时才加载）
  useEffect(() => {
    if (!E_NOISE) return
    const img = new Image()
    img.onload = () => {
      noiseRef.current = img
    }
    img.src = waterNoiseUrl
  }, [])

  // 把正在播放的音频元素接入分析器（全局唯一播放元素）
  useEffect(() => {
    const global = getPlayerAudioElement()
    wireAudioElement(global)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let last = performance.now()
    const values = new Float32Array(BAR_COUNT)
    // 暂停时降频计数：隔帧跳过，保留水面/光斑氛围动画但显著降低 CPU 占用
    let pausedSkip = 0

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
    if (E_BOKEH) initBokeh()

    const render = (now: number) => {
      // 暂停时降频到约 1/4 帧率（~15fps）：跳过的帧不重绘不清屏，
      // 水面波光等使用真实时间戳的动画仍保持原速，dt 驱动的回落/漂移略微变缓
      if (!playingRef.current) {
        pausedSkip += 1
        if (pausedSkip % 4 !== 0) {
          raf = requestAnimationFrame(render)
          return
        }
      }
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
      const waterY = Math.floor(h * WATER_RATIO)
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

      // 上半屏氛围图（保持原亮度,不再压暗）
      ctx.globalAlpha = 1
      ctx.drawImage(sc, margin, 0, w, waterY, 0, 0, w, waterY)

      // 漂浮光斑（E_BOKEH 开启时绘制）
      if (E_BOKEH) {
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
      }

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
      // 多波源扭动强度（不区分播放/停止状态）
      const baseAmp = 11
      // 涟漪环（E_RINGS 开启时叠加）
      const rings: { d: number; sigma: number; amp: number }[] = []
      if (E_RINGS && playing) {
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
      // 水中倒影：只做左右(横向)扭动,不做纵向位移,保证倒影与柱体底部相连
      for (let y = waterY; y < h; y += lineStep) {
        const t = (y - waterY) / regionH
        const row = Math.floor((y - waterY) / lineStep)
        let off = waveOff(t, row, time) * baseAmp
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

      // 点光源照亮水面：水面上方的柔光光源 + 水面上的拉长受光带,
      // 光源缓慢漂移 + 呼吸,强度不区分播放/停止
      const lx = w * 0.5 + Math.sin(time * 0.55) * w * 0.03
      const ly = waterY * 0.45
      const breath = 0.86 + 0.14 * Math.sin(time * 0.7)
      ctx.globalCompositeOperation = 'lighter'
      const srcR = Math.min(w, h) * 0.2 * breath
      const src = ctx.createRadialGradient(lx, ly, 0, lx, ly, srcR)
      src.addColorStop(0, `hsla(${hue} 85% 82% / ${0.15 * breath})`)
      src.addColorStop(1, `hsla(${hue} 85% 82% / 0)`)
      ctx.fillStyle = src
      ctx.fillRect(lx - srcR, ly - srcR, srcR * 2, srcR * 2)
      // 水面受光带：横向拉长的椭圆光斑,中心随正弦波左右扭动
      const gx = lx + Math.sin(time * 0.32) * w * 0.04
      const gy = waterY + regionH * 0.32
      ctx.save()
      ctx.translate(gx, gy)
      ctx.scale(1, 0.32)
      const wR = Math.max(w * 0.38, regionH * 1.6) * breath
      const wg = ctx.createRadialGradient(0, 0, 0, 0, 0, wR)
      wg.addColorStop(0, `hsla(${hue} 90% 75% / ${0.16 * breath})`)
      wg.addColorStop(0.55, `hsla(${hue} 90% 72% / ${0.06 * breath})`)
      wg.addColorStop(1, `hsla(${hue} 90% 72% / 0)`)
      ctx.fillStyle = wg
      ctx.fillRect(-wR, -wR, wR * 2, wR * 2)
      ctx.restore()

      // 波光粼粼：受光椭圆内散布细小高光条,相位错落的闪烁,
      // 并随波源扭动同步飘舞;伪随机每帧稳定(类 randFunc)
      const ellR = Math.max(w * 0.38, regionH * 1.6) * breath
      const ellY = ellR * 0.3
      const randF = (seed: number): number => {
        const v = Math.sin(seed * 43758.5453 + 12.9898) * 43758.5453
        return v - Math.floor(v)
      }
      for (let i = 0; i < 30; i++) {
        const r1 = randF(i + 1)
        const r2 = randF(i * 3.7 + 5)
        const r3 = randF(i * 7.3 + 9)
        const nx = r1 * 2 - 1
        const ny = r2 * 2 - 1
        const rho = nx * nx + ny * ny
        if (rho > 1) continue
        const thisX = gx + nx * ellR
        const thisY = gy + ny * ellY
        const flick = Math.sin(time * (1.1 + r3 * 2.1) + r2 * 6.283)
        if (flick <= 0.1) continue
        const t2 = (thisY - waterY) / regionH
        const row = Math.floor((thisY - waterY) / lineStep)
        const dx = waveOff(t2, row, time) * 4
        const len = (14 + r3 * 54) * dpr
        const reach = 1 - rho
        const alpha = reach * (0.05 + 0.2 * flick)
        ctx.fillStyle = `hsla(${hue} 92% 80% / ${alpha})`
        ctx.fillRect(thisX + dx - len / 2, thisY, len, Math.max(1.4, 2.6 * dpr))
      }
      ctx.globalCompositeOperation = 'source-over'

      // 水面噪纹（E_NOISE 开启时平铺 water.png）：与倒影共用同一波源扭动,
      // 逐行切片让纹路随水流一起波折
      const noise = noiseRef.current
      if (E_NOISE && noise && noise.width > 0 && w > 0) {
        const texW = noise.width * dpr * 0.6
        // 物理px ↔ noise像素 的缩放比
        const sc = texW / noise.width
        const flow = 13
        const step = Math.max(4, lineStep * 2)
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        ctx.globalAlpha = 0.1
        for (let y = waterY, row = 0; y < h; y += step, row += 1) {
          const t = (y - waterY) / regionH
          // 波源扭动 + 时间缓流
          const off = waveOff(t, row, time) * 7 + time * flow * dpr
          // 源行：含时间纵移,保证平铺连续;截边保护防止源矩形越界拉伸
          let srcY = ((y - waterY) / dpr - time * flow * 0.3) / sc % noise.height
          if (srcY < 0) srcY += noise.height
          const srcH = Math.min(noise.height, step / sc + 0.5)
          srcY = Math.min(srcY, noise.height - srcH)
          for (let x = 0; x < w; x += texW) {
            const sw = Math.min(texW, w - x)
            const neededW = sw / sc
            // 源 x：以「屏幕 x - 偏移」反解(图像右移 off),模平铺
            let sx = ((x - off) / dpr / sc) % noise.width
            if (sx < 0) sx += noise.width
            const remain = noise.width - sx
            if (remain >= neededW) {
              ctx.drawImage(noise, sx, srcY, neededW, srcH, x, y, sw, step)
            } else {
              // 跨越边缘时拆两段重绕
              const p1 = remain
              const p2 = neededW - p1
              const pixel1 = (p1 / noise.width) * texW
              ctx.drawImage(noise, sx, srcY, p1, srcH, x, y, Math.min(pixel1, sw), step)
              if (sw > pixel1) {
                ctx.drawImage(noise, 0, srcY, p2, srcH, x + pixel1, y, sw - pixel1, step)
              }
            }
          }
        }
        ctx.restore()
      }

      // 流动高光条（E_HL_BARS 开启时播放态绘制）
      if (E_HL_BARS && playing) {
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

      // 暗角（E_VIGNETTE 开启时绘制）
      if (E_VIGNETTE) {
        const vg = ctx.createRadialGradient(w / 2, h * 0.4, Math.min(w, h) * 0.36, w / 2, h * 0.5, Math.max(w, h) * 0.72)
        vg.addColorStop(0, 'rgba(0,0,0,0)')
        vg.addColorStop(1, 'rgba(0,0,0,0.28)')
        ctx.fillStyle = vg
        ctx.fillRect(0, 0, w, h)
      }

      ctx.restore()

      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // 水面覆盖层：在水线以下叠一层水体渐变,盖住没入水中的歌词（含歌词倒影）
  const glazeTop = tintRgb ? `rgba(${tintRgb}, 0.46)` : `hsla(${hue} 55% 22% / 0.46)`
  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[15]"
        style={{
          top: `${WATER_RATIO * 100}%`,
          background: `linear-gradient(to bottom, ${glazeTop} 0%, rgba(5, 10, 20, 0.55) 34%, rgba(2, 5, 11, 0.92) 100%)`,
        }}
      />
    </>
  )
}
