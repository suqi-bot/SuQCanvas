import { useEffect } from 'react'
import { CanvasBoard } from './canvas/CanvasBoard'
import { Toolbar } from './components/Toolbar'
import { Toasts } from './components/Toasts'
import { HomePage } from './components/HomePage'
import { PdfViewerModal } from './components/PdfViewerModal'
import { useProjectStore } from './store/projectStore'
import { useUiStore } from './store/uiStore'

export default function App() {
  useEffect(() => {
    void useProjectStore.getState().init().then(() => {
      useUiStore.getState().setHomeOpen(true)
    })
  }, [])

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
