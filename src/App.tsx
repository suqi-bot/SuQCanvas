import { useEffect } from 'react'
import { CanvasBoard } from './canvas/CanvasBoard'
import { Toolbar } from './components/Toolbar'
import { Toasts } from './components/Toasts'
import { HomePage } from './components/HomePage'
import { PdfViewerModal } from './components/PdfViewerModal'
import { ImageViewerModal } from './components/ImageViewerModal'
import { VideoViewerModal } from './components/VideoViewerModal'
import { MarkdownViewerModal } from './components/MarkdownViewerModal'
import { FileManagerModal } from './components/FileManagerModal'
import { GlobalPlayer } from './components/GlobalPlayer'
import { AuthPage } from './components/AuthPage'
import { useProjectStore } from './store/projectStore'
import { useUiStore } from './store/uiStore'
import { useAuthStore } from './store/authStore'
import { initLanSync, autoReconnectLan } from './sync/lanClient'
import { IS_LAN_BUILD } from './buildMode'

export default function App() {
  const user = useAuthStore((s) => s.user)
  const guest = useAuthStore((s) => s.guest)
  const loading = useAuthStore((s) => s.loading)
  const busy = useProjectStore((s) => s.busy)

  useEffect(() => {
    void useAuthStore.getState().init().then(() => {
      if (IS_LAN_BUILD) autoReconnectLan()
    })
    if (IS_LAN_BUILD) return initLanSync()
  }, [])

  const entered = user || guest

  useEffect(() => {
    if (!entered) return
    useUiStore.getState().setHomeOpen(true)
    void useProjectStore.getState().init()
  }, [entered])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-app text-sm text-dim">
        加载中…
      </div>
    )
  }
  if (!entered) return <AuthPage />

  return (
    <div className="flex h-full flex-col bg-app text-main">
      <Toolbar />
      <div className="min-h-0 flex-1">
        <CanvasBoard />
      </div>
      <HomePage />
      <PdfViewerModal />
      <ImageViewerModal />
      <VideoViewerModal />
      <MarkdownViewerModal />
      <FileManagerModal />
      <GlobalPlayer />
      <Toasts />
      {busy && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay)]">
          <div className="flex items-center gap-3 rounded-xl border border-edge bg-panel px-6 py-4 shadow-2xl">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <span className="text-sm text-soft">项目加载中…</span>
          </div>
        </div>
      )}
    </div>
  )
}
