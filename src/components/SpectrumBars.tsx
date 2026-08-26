import { useEffect, useRef } from 'react'
import { getAnalyser, wireAudioElement } from '../media/audioAnalyzer'
import { getPlayerAudioElement } from '../store/playerStore'

const BAR_COUNT = 44

/**
 * 紧凑型频谱条：播放器封面/唱片下方的一排细圆头条，随音乐跳动。
 * 颜色随封面主色(hue)变化：亮部渐变、圆头条、等距、微光。
 * 暂停/静音时保留一条低矮基线，视觉上始终有一排"呼吸"的条。
 */
export function SpectrumBars({
  playing,
  hue,
  className,
}: {
  playing: boolean
  /** 背景主色相(0..360)，来自封面取色，频谱条颜色随背景变化 */
  hue: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // 跟随背景主色：每帧读取最新色相，无需重启动画循环
  const hueRef = useRef(hue)
  hueRef.current = hue

  // 把当前音频源接入分析器（WeakSet 保证每个元素只接一次）
  useEffect(() => {
    wireAudioElement(getPlayerAudioElement())
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let last = performance.now()
    const values = new Float32Array(BAR_COUNT)

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = wrap.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)

    const render = (now: number) => {
      const w = canvas.width
      const h = canvas.height
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      ctx.clearRect(0, 0, w, h)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now

      const node = getAnalyser()
      const freqs = playing && node ? new Uint8Array(node.frequencyBinCount) : null
      if (freqs && node) node.getByteFrequencyData(freqs)

      const gap = Math.max(1.5, Math.round(dpr * 1.5))
      const barW = Math.max(1.6, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT)
      const innerH = h - dpr * 2
      const barHue = hueRef.current
      ctx.lineCap = 'round'
      for (let i = 0; i < BAR_COUNT; i++) {
        // 感知曲线:中小幅度频段的可见度更高
        let target = 0
        if (freqs && freqs.length > 0) {
          const bin = Math.floor((i / BAR_COUNT) * (freqs.length * 0.72))
          target = Math.pow(freqs[bin] / 255, 0.72)
        }
        // 上升快、回落慢
        const k = target > values[i] ? 12 : 8
        values[i] += (target - values[i]) * (1 - Math.exp(-dt * k))
        // 静音/暂停时保留低矮基线,保持一排"呼吸"的条
        const v = Math.max(values[i], 0.06)
        const bh = Math.max(2 * dpr, innerH * v)
        const x = gap / 2 + i * (barW + gap) + barW / 2
        const y0 = h - bh
        const y1 = h - dpr * 2
        // 微光(仅明显跳动的条)
        if (v > 0.14) {
          ctx.strokeStyle = `hsla(${barHue} 95% 62% / ${0.12 + v * 0.2})`
          ctx.lineWidth = barW + 2.5 * dpr
          ctx.beginPath()
          ctx.moveTo(x, y0)
          ctx.lineTo(x, y1)
          ctx.stroke()
        }
        const grad = ctx.createLinearGradient(0, y0, 0, y1)
        grad.addColorStop(0, `hsla(${barHue} 90% 72% / ${0.35 + v * 0.6})`)
        grad.addColorStop(1, `hsla(${barHue} 85% 42% / ${0.12 + v * 0.25})`)
        ctx.strokeStyle = grad
        ctx.lineWidth = barW
        ctx.beginPath()
        ctx.moveTo(x, y0)
        ctx.lineTo(x, y1)
        ctx.stroke()
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [playing])

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`} aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
