import { useEffect, useRef } from 'react'
import { getAnalyser } from '../media/audioAnalyzer'

/**
 * 底部实时频谱条：从 Web Audio 分析器读取频率数据，只在播放时跳动。
 */
export function SpectrumBars({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    const resize = () => {
      canvas.width = Math.floor(canvas.clientWidth * dpr)
      canvas.height = Math.floor(canvas.clientHeight * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const render = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      const bars = 44
      const gap = Math.max(2, w / bars / 4)
      const bw = Math.max(2, (w - gap * (bars - 1)) / bars)

      const node = getAnalyser()
      const data = playing && node ? new Uint8Array(node.frequencyBinCount) : null
      if (data && node) node.getByteFrequencyData(data)
      const binStep = data && data.length > 0 ? Math.max(1, Math.floor(data.length / bars)) : 1

      for (let i = 0; i < bars; i++) {
        let v = 0
        if (data && data.length > 0) {
          let sum = 0
          let count = 0
          const start = i * binStep
          const end = Math.min(start + binStep, data.length)
          for (let j = start; j < end; j++) {
            sum += data[j]
            count += 1
          }
          v = count > 0 ? sum / count / 255 : 0
        }
        const bh = Math.max(2, v * h)
        const x = i * (bw + gap)
        const grad = ctx.createLinearGradient(0, h, 0, h - bh)
        grad.addColorStop(0, 'rgba(56,189,248,0.95)')
        grad.addColorStop(1, 'rgba(56,189,248,0.22)')
        ctx.fillStyle = grad
        ctx.beginPath()
        const r = Math.min(bw / 2, 2)
        ctx.roundRect(x, h - bh, bw, bh, r)
        ctx.fill()
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [playing])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
