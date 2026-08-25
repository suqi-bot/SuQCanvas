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
  /** 背景主色感知亮度（0..1），用于判断前景文字该用深色还是浅色 */
  luminance: number
  /** 主色的反色色相（RGB 逐通道反色后求得）,用于前景文字与背景形成反色对色 */
  invertHue: number
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

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
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
          luminance: (rr * 0.299 + gg * 0.587 + bb * 0.114) / 255,
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
