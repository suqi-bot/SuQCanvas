import { assetKey, isOssConfigured, thumbKey } from './ossConfig'

// 局域网版构建时 define 替换为 'lan'，IS_ONLINE 折叠为 false，
// 动态导入分支被摇树移除，ossClientImpl 及其依赖的 ali-oss 不会进入产物
const IS_ONLINE: boolean = import.meta.env.VITE_BUILD_TARGET !== 'lan'

export { assetKey, isOssConfigured, thumbKey }

export interface OssClientLike {
  put(key: string, blob: Blob): Promise<unknown>
  get(key: string): Promise<{ content: unknown }>
  signatureUrl(key: string, opts: { expires: number }): string
}

export const getOssClient: () => Promise<OssClientLike | null> = IS_ONLINE
  ? async () => {
      const { getOssClient: real } = await import('./ossClientImpl')
      return (await real()) as unknown as OssClientLike | null
    }
  : async () => null

/** 上传媒体文件到 OSS，返回 oss_key */
export const uploadAssetToOss: (assetId: string, blob: Blob) => Promise<string> = IS_ONLINE
  ? async (assetId, blob) => {
      const { uploadAssetToOss: real } = await import('./ossClientImpl')
      return real(assetId, blob)
    }
  : async () => ''

/** 上传视频缩略图到 OSS */
export const uploadThumbToOss: (assetId: string, blob: Blob) => Promise<string> = IS_ONLINE
  ? async (assetId, blob) => {
      const { uploadThumbToOss: real } = await import('./ossClientImpl')
      return real(assetId, blob)
    }
  : async () => ''

/** 从 OSS 下载媒体文件 */
export const downloadAssetFromOss: (assetId: string) => Promise<Blob | null> = IS_ONLINE
  ? async (assetId) => {
      const { downloadAssetFromOss: real } = await import('./ossClientImpl')
      return real(assetId)
    }
  : async () => null

/** 从 OSS 下载视频缩略图 */
export const getOssThumb: (assetId: string) => Promise<{ content: Blob }> = IS_ONLINE
  ? async (assetId) => {
      const { getOssThumb: real } = await import('./ossClientImpl')
      return real(assetId)
    }
  : async () => {
      throw new Error('OSS 未配置')
    }

/** 获取 OSS 媒体文件可访问 URL（私有桶为签名 URL，默认 1 小时有效） */
export const getOssUrl: (assetId: string) => Promise<string | null> = IS_ONLINE
  ? async (assetId) => {
      const { getOssUrl: real } = await import('./ossClientImpl')
      return real(assetId)
    }
  : async () => null
