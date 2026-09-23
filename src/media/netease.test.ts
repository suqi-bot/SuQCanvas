import { describe, expect, it } from 'vitest'
import {
  isNeteaseInput,
  neteaseUrlFor,
  parseNeteaseDragPayload,
  parseNeteaseTarget,
  NETEASE_DRAG_MIME,
} from './netease'

describe('parseNeteaseTarget', () => {
  it('treats empty as home', () => {
    expect(parseNeteaseTarget('')).toEqual({ type: 'home' })
    expect(parseNeteaseTarget(undefined)).toEqual({ type: 'home' })
  })

  it('accepts bare ids and common song urls', () => {
    expect(parseNeteaseTarget('123')).toEqual({ type: 'song', id: '123' })
    expect(parseNeteaseTarget('https://music.163.com/#/song?id=456')).toEqual({ type: 'song', id: '456' })
    expect(parseNeteaseTarget('https://music.163.com/song?id=789')).toEqual({ type: 'song', id: '789' })
  })

  it('rejects foreign hosts', () => {
    expect(parseNeteaseTarget('https://example.com/song?id=1')).toBeNull()
    expect(isNeteaseInput('not a url')).toBe(false)
  })
})

describe('neteaseUrlFor', () => {
  it('builds hash routes', () => {
    expect(neteaseUrlFor({ type: 'song', id: '1' })).toBe('https://music.163.com/#/song?id=1')
    expect(neteaseUrlFor({ type: 'playlist', id: '2' })).toBe('https://music.163.com/#/playlist?id=2')
    expect(neteaseUrlFor({ type: 'home' })).toBe('https://music.163.com/')
  })
})

describe('parseNeteaseDragPayload', () => {
  it('accepts valid song payloads', () => {
    expect(
      parseNeteaseDragPayload(JSON.stringify({ id: '123', name: '歌名', artist: '歌手' })),
    ).toEqual({ id: '123', name: '歌名', artist: '歌手', coverUrl: undefined })
  })

  it('rejects empty or non-numeric ids', () => {
    expect(parseNeteaseDragPayload('')).toBeNull()
    expect(parseNeteaseDragPayload('not-json')).toBeNull()
    expect(parseNeteaseDragPayload(JSON.stringify({ id: 'abc' }))).toBeNull()
    expect(NETEASE_DRAG_MIME).toBe('application/x-suqcanvas-netease')
  })
})
