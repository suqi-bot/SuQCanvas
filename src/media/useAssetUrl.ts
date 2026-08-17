import { useEffect, useRef, useState } from 'react'
import { getAssetUrl, getThumbnailUrl } from './blobRegistry'
import { toast } from '../store/uiStore'

const MAX_ATTEMPTS = 5
const RETRY_DELAY = 1200

export function useAssetUrl(assetId?: string): string | undefined {
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
