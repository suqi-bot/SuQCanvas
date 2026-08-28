import { genUuid } from './uuid'

const KEY = 'sq:device-id'

export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored) return stored
    const id = genUuid()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    return genUuid()
  }
}
