import { useEffect } from 'react'
import { CanvasBoard } from './canvas/CanvasBoard'
import { Toolbar } from './components/Toolbar'
import { Toasts } from './components/Toasts'
import { HomePage } from './components/HomePage'
import { PdfViewerModal } from './components/PdfViewerModal'
import { AuthPage } from './components/AuthPage'
import { useProjectStore } from './store/projectStore'
import { useUiStore } from './store/uiStore'
import { useAuthStore } from './store/authStore'
import { initLanSync } from './sync/lanClient'

export default function App() {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)

  useEffect(() => {
    void useAuthStore.getState().init()
    const stopLanSync = initLanSync()
    return () => stopLanSync()
  }, [])

  useEffect(() => {
    if (!user) return
    void useProjectStore.getState().init().then(() => {
      useUiStore.getState().setHomeOpen(true)
    })
  }, [user])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-app text-sm text-dim">
        加载中…
      </div>
    )
  }
  if (!user) return <AuthPage />

  return (
    <div className="flex h-full flex-col bg-app text-main">
      <Toolbar />
      <div className="min-h-0 flex-1">
        <CanvasBoard />
      </div>
      <HomePage />
      <PdfViewerModal />
      <Toasts />
    </div>
  )
}
