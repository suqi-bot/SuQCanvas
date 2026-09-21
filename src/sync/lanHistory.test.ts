import { afterEach, expect, it, vi } from 'vitest'
import { recentLanServers, rememberLanServer } from './lanHistory'

afterEach(() => vi.unstubAllGlobals())
it('keeps a bounded, deduplicated list of successful servers and their latest nickname', () => {
  let data = ''
  vi.stubGlobal('localStorage', { getItem: () => data, setItem: (_: string, value: string) => { data = value } })
  for (let i = 0; i < 12; i++) rememberLanServer(`ws://host-${i}:8790`, '旧昵称')
  rememberLanServer('ws://host-11:8790', '新昵称')
  expect(recentLanServers()).toHaveLength(8)
  expect(recentLanServers()[0]).toMatchObject({ url: 'ws://host-11:8790', name: '新昵称' })
  expect(new Set(recentLanServers().map((s) => s.url)).size).toBe(8)
})
