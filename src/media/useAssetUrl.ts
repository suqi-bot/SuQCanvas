import { useEffect, useRef, useState } from 'react'
import { getAssetUrl, getThumbnailUrl } from './blobRegistry'
import { isLanConnected } from '../sync/lanClient'
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

const THUMB_FAST_ATTEMPTS = 16
const THUMB_FAST_DELAY = 500
const THUMB_SLOW_DELAY = 2000
/** 局域网下封面依赖对端/中继传输，连接期间最长等待 5 分钟 */
const THUMB_LAN_WAIT_MS = 300_000

export function useThumbnailUrl(assetId?: string): string | undefined {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!assetId) {
      setUrl(undefined)
      return
    }
    let alive = true
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()

    // 封面（局域网视频）依赖 asset-thumb / asset-http 消息，就绪可能需要几十秒，
    // 只要还连着局域网就持续轮询；离线场景保持快速失败，不做无谓重试
    const scheduleNext = () => {
      attempts += 1
      if (attempts < THUMB_FAST_ATTEMPTS) {
        timer = setTimeout(poll, THUMB_FAST_DELAY)
      } else if (isLanConnected() && Date.now() - startedAt < THUMB_LAN_WAIT_MS) {
        timer = setTimeout(poll, THUMB_SLOW_DELAY)
      } else {
        setUrl(undefined)
      }
    }

    const poll = () => {
      if (!alive) return
      getThumbnailUrl(assetId)
        .then((u) => {
          if (!alive) return
          if (u) setUrl(u)
          else scheduleNext()
        })
        .catch(() => {
          if (alive) scheduleNext()
        })
    }

    poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
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
