// Native dialogs keep update controls available without exposing updater IPC.
function createUpdater({ app, window, dialog, autoUpdater, requestInstall }) {
  let busy = false
  let downloaded = false
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  // Errors also reject check/download promises; consume the event to avoid crashing.
  autoUpdater.on('error', () => {})
  autoUpdater.on('download-progress', ({ percent }) => {
    window.setProgressBar(percent / 100)
    window.setTitle(`SuQCanvas 桌面版 · 更新下载 ${Math.round(percent)}%`)
  })
  async function offerInstall() {
    const { response } = await dialog.showMessageBox(window, {
      type: 'info', message: '更新已下载', detail: '安装前将保存当前本地项目，然后重启应用。',
      buttons: ['保存并重启安装', '稍后'], defaultId: 0, cancelId: 1,
    })
    if (response === 0) requestInstall()
  }
  async function check(manual = false) {
    if (busy) {
      if (manual) await dialog.showMessageBox(window, { message: '正在检查或下载更新，请稍候。' })
      return
    }
    if (!app.isPackaged) {
      if (manual) await dialog.showMessageBox(window, { message: '开发模式不检查更新，请使用安装版。' })
      return
    }
    busy = true
    let downloading = false
    try {
      if (downloaded) { await offerInstall(); return }
      const result = await autoUpdater.checkForUpdates()
      if (!result || !result.isUpdateAvailable) {
        if (manual) await dialog.showMessageBox(window, { message: `当前已是最新版本（${app.getVersion()}）` })
        return
      }
      const notes = result.updateInfo.releaseNotes
      const detail = (typeof notes === 'string' ? notes : Array.isArray(notes)
        ? notes.map((entry) => entry.note || '').join('\n') : '')
        .replace(/<[^>]*>/g, '').slice(0, 3000)
      const { response } = await dialog.showMessageBox(window, {
        type: 'info', message: `发现新版本 ${result.updateInfo.version}`,
        detail: detail || '有新版本可用，是否下载？下载期间可以继续使用。',
        buttons: ['下载更新', '稍后'], defaultId: 0, cancelId: 1,
      })
      if (response !== 0) return
      downloading = true
      await autoUpdater.downloadUpdate()
      downloaded = true
      await offerInstall()
    } catch {
      if (manual || downloading) await dialog.showMessageBox(window, {
        type: 'error', message: downloading ? '更新下载失败' : '无法检查更新',
        detail: '请检查网络连接，并确认 GitHub Releases 已发布更新文件。稍后可在“帮助 → 检查更新”重试。',
      })
    } finally {
      busy = false
      window.setProgressBar(-1)
      window.setTitle('SuQCanvas 桌面版')
    }
  }
  return { check, install: () => { if (downloaded) autoUpdater.quitAndInstall(false, true) } }
}
module.exports = { createUpdater }
