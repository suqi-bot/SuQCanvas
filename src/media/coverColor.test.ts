import { describe, expect, it } from 'vitest'
import { contrastRatio, relativeLuminance } from './coverColor'

describe('relativeLuminance', () => {
  it('黑白为 0/1', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5)
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5)
  })

  it('灰阶单调递增', () => {
    let prev = -1
    for (const v of [0, 32, 64, 96, 128, 160, 192, 224, 255]) {
      const lum = relativeLuminance(v, v, v)
      expect(lum).toBeGreaterThan(prev)
      prev = lum
    }
  })

  it('绿色对亮度的贡献大于蓝色(人眼敏感度)', () => {
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(0, 0, 255))
  })
})

describe('contrastRatio', () => {
  it('黑白之间为 21', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 3)
  })

  it('相同颜色为 1', () => {
    expect(contrastRatio(0.4, 0.4)).toBeCloseTo(1, 5)
  })

  it('与参数顺序无关', () => {
    expect(contrastRatio(0.2, 0.9)).toBeCloseTo(contrastRatio(0.9, 0.2), 5)
  })

  it('背景亮度 0.18 时白字与黑字对比度持平(WCAG 数学边界)', () => {
    // (1 + 0.05) / (l + 0.05) == (l + 0.05) / 0.05  =>  l ≈ 0.179
    const white = contrastRatio(0.179, 1)
    const black = contrastRatio(0.179, 0)
    expect(Math.abs(white - black)).toBeLessThan(0.02)
  })
})
