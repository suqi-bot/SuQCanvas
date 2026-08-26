import { useEffect, useState } from 'react'

export interface CoverPalette {
  /** 主色相（0..360） */
  hue: number
  /** 高饱和强调色（用于按钮/文字/高亮） */
  accent: string
  /** 强调色的 RGB 分量（如 "r,g,b"，用于生成半透明光晕） */
  accentRgb: string
  /** 主色 RGB 分量（用于背景着色，如 "r,g,b"） */
  tintRgb: string
  /**
   * 歌词区背景的 WCAG 相对亮度（0..1）：按播放器上半屏的显示方式
   * cover-fit 裁剪后逐像素均值的线性化亮度，用于前景文字深浅抉择。
   */
  bgLum: number
  /** 主色的反色色相（RGB 逐通道反色后求得）,用于前景文字与背景形成反色对色 */
  invertHue: number
}

/** sRGB 单通道线性化（WCAG 相对亮度用） */
function srgbChannel(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

/** WCAG 2.x 相对亮度（0..1）：线性化后按人眼敏感度加权 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
}

/** WCAG 对比度（1..21）：两个相对亮度之间的对比度比 */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rr:
        h = (gg - bb) / d + (gg < bb ? 6 : 0)
        break
      case gg:
        h = (bb - rr) / d + 2
        break
      default:
        h = (rr - gg) / d + 4
    }
    h /= 6
  }
  return { h: h * 360, s, l }
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
    b = 0
  } else if (h < 120) {
    r = x
    g = c
    b = 0
  } else if (h < 180) {
    r = 0
    g = c
    b = x
  } else if (h < 240) {
    r = 0
    g = x
    b = c
  } else if (h < 300) {
    r = x
    g = 0
    b = c
  } else {
    r = c
    g = 0
    b = x
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

/**
 * 采样歌词区背景亮度：按播放器背景的实际显示方式对封面 cover-fit 裁剪
 * （背景铺满全屏视口），再取逐像素 WCAG 亮度的均值。
 * 相比「整张封面拉伸到 48×48 求平均」，这更接近歌词真正压住的画面。
 */
function sampleLyricRegionLum(img: HTMLImageElement): number | null {
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 720
  const regionH = Math.max(1, vh)
  const ir = img.width / img.height
  const r = vw / regionH
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
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    sum += relativeLuminance(data[i], data[i + 1], data[i + 2])
    count += 1
  }
  return count > 0 ? sum / count : null
}

/**
 * 从专辑封面取主色：优先采用高饱和像素的均值（更接近「主题色」），
 * 并把饱和度/亮度压到适合深色背景的高档强调色区间。
 */
export function extractCoverPalette(url: string): Promise<CoverPalette | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 48
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        let r = 0
        let g = 0
        let b = 0
        let count = 0
        let vr = 0
        let vg = 0
        let vb = 0
        let vcount = 0
        for (let i = 0; i < data.length; i += 4) {
          const cr = data[i]
          const cg = data[i + 1]
          const cb = data[i + 2]
          const alpha = data[i + 3]
          if (alpha < 128) continue
          r += cr
          g += cg
          b += cb
          count += 1
          const max = Math.max(cr, cg, cb)
          const min = Math.min(cr, cg, cb)
          const sat = max === 0 ? 0 : (max - min) / max
          const l = (max + min) / 510
          if (sat > 0.3 && l > 0.16 && l < 0.86) {
            vr += cr
            vg += cg
            vb += cb
            vcount += 1
          }
        }
        if (count === 0) {
          resolve(null)
          return
        }
        const useVibrant = vcount >= count * 0.06
        const rr = useVibrant ? vr / vcount : r / count
        const gg = useVibrant ? vg / vcount : g / count
        const bb = useVibrant ? vb / vcount : b / count
        const { h, s, l } = rgbToHsl(rr, gg, bb)
        const sat = Math.max(0.6, Math.min(0.95, s))
        const light = Math.max(0.54, Math.min(0.66, l + 0.06))
        const accentRgb = hslToRgb(h, sat, light)
        // 逐通道反色后的色相：与背景主色天然互补
        const inv = rgbToHsl(255 - rr, 255 - gg, 255 - bb)
        resolve({
          hue: h,
          accent: `hsl(${Math.round(h)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%)`,
          accentRgb: `${accentRgb.r},${accentRgb.g},${accentRgb.b}`,
          tintRgb: `${Math.round(rr)},${Math.round(gg)},${Math.round(bb)}`,
          bgLum: sampleLyricRegionLum(img) ?? relativeLuminance(rr, gg, bb),
          invertHue: inv.h,
        })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 封面加载后解析其主色调，供播放器背景/可视化/控件统一取色。 */
export function useCoverPalette(url?: string): CoverPalette | null {
  const [palette, setPalette] = useState<CoverPalette | null>(null)

  useEffect(() => {
    if (!url) {
      setPalette(null)
      return
    }
    let alive = true
    // 保留上一张封面的取色,新封面解析完成后再替换,避免轮换瞬间颜色跳回默认值
    void extractCoverPalette(url).then((result) => {
      if (alive && result) setPalette(result)
    })
    return () => {
      alive = false
    }
  }, [url])

  return palette
}
