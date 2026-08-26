import { useEffect, useRef } from 'react'

const FALLBACK_BG = '#030509'

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

/**
 * 沉浸式播放器背景：专辑封面 cover-fit 铺满全屏，多张封面轮换时 0.9s 交叉淡入，
 * 底部轻微压暗以衬托控制栏/浮层的可读性。
 */
export function AudioBackground({
  coverUrl,
  hue,
  tintRgb,
}: {
  coverUrl?: string
  /** 兼容原接口：不再驱动动画，保留字段 */
  playing: boolean
  hue: number
  tintRgb?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const coverRef = useRef<HTMLImageElement | null>(null)
  // 封面轮换时的交叉淡入:from 为上一张封面,start 为切换起始时间
  const transitionRef = useRef<{ from: HTMLImageElement | null; start: number }>({ from: null, start: 0 })

  useEffect(() => {
    let alive = true
    if (!coverUrl) {
      coverRef.current = null
      transitionRef.current = { from: null, start: 0 }
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let lastCover: HTMLImageElement | null = null
    let lastSize = ''

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const w = canvas.width
      const h = canvas.height
      if (w === 0 || h === 0) return
      const cover = coverRef.current
      // 仅封面变化/淡入中/尺寸变化时重绘,静态时零开销
      const fading = !!cover && transitionRef.current.from != null && transitionRef.current.from !== cover
      const sizeKey = `${w}x${h}`
      if (cover === lastCover && lastSize === sizeKey && !fading) return
      lastCover = cover
      lastSize = sizeKey

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = FALLBACK_BG
      ctx.fillRect(0, 0, w, h)
      if (cover && cover.width) {
        drawCoverFit(ctx, cover, w, h)
        const tr = transitionRef.current
        if (tr.from && tr.from !== cover) {
          const fade = Math.min(1, (now - tr.start) / 900)
          ctx.globalAlpha = 1 - fade
          drawCoverFit(ctx, tr.from, w, h)
          ctx.globalAlpha = 1
          if (fade >= 1) transitionRef.current = { from: null, start: 0 }
        }
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, `hsl(${hue} 45% 9%)`)
        g.addColorStop(1, `hsl(${hue} 55% 13%)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      // 底部压暗:衬托控制栏可读性(带一点背景主色)
      const bg = ctx.createLinearGradient(0, h * 0.5, 0, h)
      bg.addColorStop(0, tintRgb ? `rgba(${tintRgb}, 0.1)` : 'rgba(2,5,11,0.12)')
      bg.addColorStop(1, 'rgba(2,5,11,0.8)')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
}
