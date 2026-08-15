import { useEffect } from 'react'
import { CanvasBoard } from './canvas/CanvasBoard'
import { Toolbar } from './components/Toolbar'
import { Toasts } from './components/Toasts'
import { PdfViewerModal } from './components/PdfViewerModal'
import { ProjectManager } from './components/ProjectManager'
import { useProjectStore } from './store/projectStore'

export default function App() {
  useEffect(() => {
    void useProjectStore.getState().init()
  }, [])

  return (
    <div className="flex h-full flex-col bg-app text-main">
      <Toolbar />
      <div className="min-h-0 flex-1">
        <CanvasBoard />
      </div>
      <PdfViewerModal />
      <ProjectManager />
      <Toasts />
    </div>
  )
}
