import { useEffect, useState } from 'react'
import { getAssetUrl, getThumbnailUrl } from './blobRegistry'
import { toast } from '../store/uiStore'

export function useAssetUrl(assetId?: string): string | undefined {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!assetId) {
      setUrl(undefined)
      return
    }
    let alive = true
    getAssetUrl(assetId)
      .then((u) => {
        if (alive) setUrl(u)
      })
      .catch(() => {
        if (alive) toast('资源加载失败', 'error')
      })
    return () => {
      alive = false
    }
  }, [assetId])

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
