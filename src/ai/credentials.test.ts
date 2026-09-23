import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIALS_STORAGE, hydrateCredentials, loadCredentials, loadCredentialsSync, mergeCredentials, saveCredentials } from './credentials'

function localStore(data: Record<string, string> = {}) {
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value },
    removeItem: (key: string) => { delete data[key] },
    data,
  }
}

describe('AI credentials persistence', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges non-empty fields so empty sources cannot wipe saved keys', () => {
    expect(mergeCredentials({ comfyKey: '', cloudKey: 'cloud', llmKey: '' }, { comfyKey: 'comfy', cloudKey: '', llmKey: 'llm' }))
      .toEqual({ comfyKey: 'comfy', cloudKey: 'cloud', llmKey: 'llm' })
    expect(mergeCredentials({}, null, undefined)).toEqual({ comfyKey: '', cloudKey: '', llmKey: '' })
  })

  it('keeps keys when desktop file read returns empty', async () => {
    const store = localStore({ [CREDENTIALS_STORAGE]: JSON.stringify({ comfyKey: 'file-miss-local', cloudKey: '', llmKey: 'llm' }) })
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('window', { suqDesktop: { readAiCredentials: async () => ({ comfyKey: '', cloudKey: '', llmKey: '' }) } })
    const loaded = await loadCredentials()
    expect(loaded.comfyKey).toBe('file-miss-local')
    expect(loaded.llmKey).toBe('llm')
    const hydrated = await hydrateCredentials()
    expect(hydrated.comfyKey).toBe('file-miss-local')
    expect(JSON.parse(store.data[CREDENTIALS_STORAGE]).comfyKey).toBe('file-miss-local')
  })

  it('prefers desktop file keys over stale localStorage', async () => {
    const store = localStore({ [CREDENTIALS_STORAGE]: JSON.stringify({ comfyKey: 'stale', cloudKey: 'stale-cloud', llmKey: '' }) })
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('window', {
      suqDesktop: {
        readAiCredentials: async () => ({ comfyKey: 'fresh', cloudKey: '', llmKey: 'fresh-llm' }),
        writeAiCredentials: async () => true,
      },
    })
    expect(await loadCredentials()).toEqual({ comfyKey: 'fresh', cloudKey: 'stale-cloud', llmKey: 'fresh-llm' })
    await saveCredentials({ comfyKey: 'fresh', cloudKey: 'fresh-cloud', llmKey: 'fresh-llm' })
    expect(JSON.parse(store.data[CREDENTIALS_STORAGE])).toEqual({ comfyKey: 'fresh', cloudKey: 'fresh-cloud', llmKey: 'fresh-llm' })
  })

  it('serializes rapid saves so the last key wins', async () => {
    const store = localStore()
    vi.stubGlobal('localStorage', store)
    const writes: string[] = []
    vi.stubGlobal('window', {
      suqDesktop: {
        readAiCredentials: async () => ({}),
        writeAiCredentials: async (credentials: { comfyKey: string }) => {
          await new Promise((resolve) => setTimeout(resolve, credentials.comfyKey === 'a' ? 20 : 1))
          writes.push(credentials.comfyKey)
        },
      },
    })
    await Promise.all([
      saveCredentials({ comfyKey: 'a', cloudKey: '', llmKey: '' }),
      saveCredentials({ comfyKey: 'ab', cloudKey: '', llmKey: '' }),
      saveCredentials({ comfyKey: 'abc', cloudKey: '', llmKey: '' }),
    ])
    expect(writes).toEqual(['a', 'ab', 'abc'])
    expect(loadCredentialsSync().comfyKey).toBe('abc')
  })
})
