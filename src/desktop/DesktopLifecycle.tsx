import { useEffect } from 'react'
import { db } from '../db/db'
import { importProjectFile } from '../io/importExport'
import { useProjectStore } from '../store/projectStore'
import { toast, useUiStore } from '../store/uiStore'
import { hasRunningAiTasks, prepareAiExit } from '../ai/generation'

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
        if (hasRunningAiTasks()) {
          if (!window.confirm('仍有 AI 图片正在生成。退出后将停止等待，已记录编号的 ComfyUI 任务可在下次打开时恢复；其他任务需检查服务端结果。确定退出？')) {
            bridge.closeReady(false); return
          }
          await prepareAiExit()
        }
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
