import type { MediaKind, SuqNode } from '../types'

export interface ManagedFile {
  assetId: string
  name: string
  kind: MediaKind
  mime: string
  size: number
  nodes: SuqNode[]
}

export function isMp3(file: ManagedFile): boolean {
  return file.kind === 'audio' && (file.mime.toLowerCase() === 'audio/mpeg' || /\.mp3$/i.test(file.name))
}
