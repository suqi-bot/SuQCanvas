import type { SuqNode, SuqNodeData } from '../types'

export interface AiTask {
  id: string
  projectId: string
  projectName: string
  nodeId: string
  owner: string
  createdAt: number
  updatedAt: number
  state: 'running' | 'paused' | 'ready' | 'done' | 'error'
  message: string
  info: NonNullable<SuqNodeData['ai']>
  serviceUrl: string
  needsKey: boolean
  promptId?: string
  sourceBlob?: Blob
  grid?: { rows: number; columns: number; gap: number; margin: number }
  blobs?: Blob[]
  resultNodes?: SuqNode[]
  /** 图生图（genMode=edit）已落库的预览资源，应用后替换原图 */
  previewAssetId?: string
}

export const aiJobKey = (projectId: string | null, nodeId: string) => `${projectId ?? ''}:${nodeId}`
