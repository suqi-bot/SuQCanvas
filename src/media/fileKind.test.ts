import { describe, expect, it } from 'vitest'
import { detectKind } from './fileKind'

function file(name: string, type = ''): File {
  return { name, type } as File
}

describe('detectKind', () => {
  it('recognizes PSD before generic image MIME handling', () => {
    expect(detectKind(file('design.PSD', 'image/vnd.adobe.photoshop'))).toBe('psd')
  })

  it('keeps regular images as image assets', () => {
    expect(detectKind(file('photo.png', 'image/png'))).toBe('image')
  })
})
