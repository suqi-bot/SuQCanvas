import { useEffect, useRef, useState } from 'react'
import { getAssetUrl, getThumbnailUrl } from './blobRegistry'
import { toast } from '../store/uiStore'
import { ensurePsdPreview } from './psdPreview'

const MAX_ATTEMPTS = 5
const RETRY_DELAY = 1200

export function useAssetUrl(assetId?: string, version?: number): string | undefined {
  const [url, setUrl] = useState<string>()
  const retryRef = useRef(0)

  useEffect(() => {
    if (!assetId) {
      setUrl(undefined)
      return
    }
    let alive = true
    retryRef.current = 0
    const load = () => {
      getAssetUrl(assetId)
        .then((u) => {
          if (alive) setUrl(u)
        })
        .catch(() => {
          if (!alive) return
          // 资源可能仍在局域网传输中，稍后重试而不是直接失败
          if (retryRef.current < MAX_ATTEMPTS) {
            retryRef.current += 1
            setTimeout(load, RETRY_DELAY)
          } else {
            toast('资源加载失败', 'error')
          }
        })
    }
    load()
    return () => {
      alive = false
    }
  }, [assetId, version])

  return url
}

export function useThumbnailUrl(assetId?: string): string | undefined {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!assetId) {
      setUrl(undefined)
      return
    }
    let alive = true
    getThumbnailUrl(assetId)
      .then((u) => {
        if (alive) setUrl(u)
      })
      .catch(() => {
        if (alive) setUrl(undefined)
      })
    return () => {
      alive = false
    }
  }, [assetId])

  return url
}

export function useAssetSourceUrl(
  assetId?: string,
  source: 'asset' | 'thumbnail' = 'asset',
): string | undefined {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!assetId) {
      setUrl(undefined)
      return
    }
    let alive = true
    const getUrl = source === 'thumbnail' ? getThumbnailUrl : getAssetUrl
    getUrl(assetId)
      .then((nextUrl) => {
        if (alive) setUrl(nextUrl)
      })
      .catch(() => {
        if (alive) toast('资源加载失败', 'error')
      })
    return () => {
      alive = false
    }
  }, [assetId, source])

  return url
}

export function usePsdPreviewUrl(assetId?: string): string | undefined {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!assetId) {
      setUrl(undefined)
      return
    }
    let alive = true
    const load = async () => {
      let previewUrl = await getThumbnailUrl(assetId)
      if (!previewUrl) {
        await ensurePsdPreview(assetId)
        previewUrl = await getThumbnailUrl(assetId)
      }
      if (alive) setUrl(previewUrl)
    }
    void load().catch((error) => {
      console.warn('PSD 预览加载失败:', error)
      if (alive) toast('PSD 无法预览，可能格式不受支持或文件过大', 'error')
    })
    return () => {
      alive = false
    }
  }, [assetId])

  return url
}
