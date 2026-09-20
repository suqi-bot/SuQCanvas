import { useEffect } from 'react'
import { db } from '../db/db'
import { importProjectFile } from '../io/importExport'
import { useProjectStore } from '../store/projectStore'
import { toast, useUiStore } from '../store/uiStore'

export function DesktopLifecycle() {
  const initialized = useProjectStore((s) => s.initialized)
  useEffect(() => {
    const bridge = window.suqDesktop
    if (!bridge || !initialized) return
    const stopOpen = bridge.onOpenProject((file) => {
      void (async () => {
        if (useProjectStore.getState().busy) throw new Error('请等待当前操作完成后再导入')
        useProjectStore.getState().setBusy(true)
        try {
          await importProjectFile(new File([file.bytes], file.name))
          useUiStore.getState().setHomeOpen(false)
        } finally { useProjectStore.getState().setBusy(false) }
      })().catch((error) => toast(error instanceof Error ? error.message : '导入失败', 'error'))
    })
    const stopClose = bridge.onBeforeClose(() => {
      void (async () => {
        if (useProjectStore.getState().busy) { bridge.closeReady(false); return }
        // Text nodes commit their draft on blur; include the final keystrokes when closing.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        await useProjectStore.getState().saveNow()
        if (useProjectStore.getState().saveStatus === 'error') { bridge.closeReady(false); return }
        db.close()
        bridge.closeReady(true)
      })().catch(() => bridge.closeReady(false))
    })
    bridge.ready()
    return () => { stopOpen(); stopClose() }
  }, [initialized])
  return null
}
