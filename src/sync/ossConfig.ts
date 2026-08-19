// 直接读取构建目标：define 替换后为模块内字面量，死分支可被摇树移除
const IS_ONLINE: boolean = import.meta.env.VITE_BUILD_TARGET !== 'lan'

export function isOssConfigured(): boolean {
  if (!IS_ONLINE) return false
  const region = import.meta.env.VITE_OSS_REGION
  const bucket = import.meta.env.VITE_OSS_BUCKET
  const accessKeyId = import.meta.env.VITE_OSS_ACCESS_KEY_ID
  const stsUrl = import.meta.env.VITE_OSS_STS_URL
  return Boolean(region && bucket && (accessKeyId || stsUrl))
}

export function assetKey(assetId: string): string {
  return `assets/${assetId}.bin`
}

export function thumbKey(assetId: string): string {
  return `assets/${assetId}.thumb`
}
