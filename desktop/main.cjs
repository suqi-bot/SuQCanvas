const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require('electron')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { autoUpdater } = require('electron-updater')
const { createUpdater } = require('./updater.cjs')
const { aiRequest } = require('./ai-request.cjs')
const { createNeteasePanel } = require('./netease.cjs')

const APP_URL = 'suqcanvas://app/SuQCanvas/'
protocol.registerSchemesAsPrivileged([{ scheme: 'suqcanvas', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }])
// A fixed origin and data directory preserve IndexedDB across application upgrades.
app.setPath('userData', process.env.SUQCANVAS_TEST_DATA || path.join(app.getPath('appData'), 'SuQCanvas'))
app.setAppUserModelId('com.suqcanvas.desktop')
let window
let closing = false
let closeTimer
let rendererReady = false
let installRequested = false
let updater
const pendingFiles = process.argv.filter((arg) => path.isAbsolute(arg) && arg.toLowerCase().endsWith('.sqcanvas'))
/** 网易云嵌入面板（WebContentsView），登录态 persist:netease */
let neteasePanel

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      !event.senderFrame.url.startsWith(APP_URL)) throw new Error('Untrusted application frame')
}

async function deliverFiles() {
  if (!rendererReady || !window || window.isDestroyed()) return
  while (pendingFiles.length) {
    const file = pendingFiles.shift()
    try {
      const bytes = await readFile(file)
      window.webContents.send('desktop:open-project', { name: path.basename(file), bytes })
    } catch (error) {
      dialog.showErrorBox('无法打开项目', error.message)
    }
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    pendingFiles.push(...argv.filter((arg) => path.isAbsolute(arg) && arg.toLowerCase().endsWith('.sqcanvas')))
    if (window?.isMinimized()) window.restore()
    window?.focus()
    void deliverFiles()
  })
  app.whenReady().then(async () => {
    await mkdir(app.getPath('userData'), { recursive: true })
    const webRoot = path.resolve(__dirname, '../dist-desktop')
    protocol.handle('suqcanvas', async (request) => {
      const url = new URL(request.url)
      if (url.host !== 'app' || !url.pathname.startsWith('/SuQCanvas/')) return new Response('', { status: 404 })
      const relative = decodeURIComponent(url.pathname.slice('/SuQCanvas/'.length)) || 'index.html'
      const file = path.resolve(webRoot, relative)
      if (!file.startsWith(webRoot + path.sep)) return new Response('', { status: 403 })
      const response = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; media-src 'self' blob: http: https:; connect-src 'self' blob: ws: wss: http: https:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'")
      return new Response(response.body, { status: response.status, headers })
    })
    window = new BrowserWindow({
      title: 'SuQCanvas 桌面版', width: 1360, height: 900, minWidth: 1000, minHeight: 680,
      backgroundColor: '#0f172a', show: false, icon: path.join(__dirname, 'icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true },
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(APP_URL)) event.preventDefault()
    })
    window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write')
    })
    window.once('ready-to-show', () => window.show())
    updater = createUpdater({ app, window, dialog, autoUpdater, requestInstall: () => {
      if (closeTimer || closing) return
      installRequested = true
      window.close()
    } })
    window.on('close', (event) => {
      if (closing) return
      event.preventDefault()
      if (closeTimer) return
      window.webContents.send('desktop:before-close')
      closeTimer = setTimeout(async () => {
        closeTimer = undefined
        if (installRequested) {
          installRequested = false
          await dialog.showMessageBox(window, { type: 'warning', message: '尚未确认保存完成，已取消安装。请稍后通过“检查更新”重试。' })
          return
        }
        const { response } = await dialog.showMessageBox(window, { type: 'warning',
          message: '应用尚未确认保存完成', detail: '可以返回继续等待，或退出应用。',
          buttons: ['返回应用', '仍然退出'], defaultId: 0, cancelId: 0 })
        if (response === 1) { closing = true; window.close() }
      }, 15000)
    })
    ipcMain.on('desktop:ready', (event) => {
      trusted(event)
      if (!rendererReady) void updater.check()
      rendererReady = true
      void deliverFiles()
    })
    ipcMain.on('desktop:close-ready', (event, ok) => {
      trusted(event)
      clearTimeout(closeTimer)
      closeTimer = undefined
      if (ok === true) {
        closing = true
        if (installRequested) updater.install()
        else window.close()
      } else {
        installRequested = false
        void dialog.showMessageBox(window, { type: 'error', message: '项目尚未保存成功或传输仍在进行，请完成后再退出。' })
      }
    })
    ipcMain.handle('desktop:save-file', async (event, name, bytes) => {
      trusted(event)
      if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('无效的项目文件')
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: path.basename(name), filters: [{ name: 'SuQCanvas 项目', extensions: ['sqcanvas'] }],
      })
      if (canceled || !filePath) return false
      await writeFile(filePath, bytes)
      return true
    })
    ipcMain.handle('desktop:show-data', async (event) => { trusted(event); return shell.openPath(app.getPath('userData')) })
    const AI_CREDENTIALS_FILE = 'ai-credentials.json'
    ipcMain.handle('desktop:read-ai-credentials', async (event) => {
      trusted(event)
      try {
        const raw = await readFile(path.join(app.getPath('userData'), AI_CREDENTIALS_FILE), 'utf8')
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return {}
        const pick = (key) => (typeof parsed[key] === 'string' ? parsed[key] : '')
        return { comfyKey: pick('comfyKey'), cloudKey: pick('cloudKey'), llmKey: pick('llmKey') }
      } catch {
        return {}
      }
    })
    ipcMain.handle('desktop:write-ai-credentials', async (event, credentials) => {
      trusted(event)
      if (!credentials || typeof credentials !== 'object') throw new Error('无效的凭据')
      const pick = (key) => (typeof credentials[key] === 'string' ? credentials[key] : '')
      const payload = { comfyKey: pick('comfyKey'), cloudKey: pick('cloudKey'), llmKey: pick('llmKey'), updatedAt: Date.now() }
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(path.join(app.getPath('userData'), AI_CREDENTIALS_FILE), JSON.stringify(payload, null, 2), 'utf8')
      return true
    })
    const aiRequests = new Map()
    ipcMain.handle('desktop:ai-request', async (event, request) => {
      trusted(event)
      const id = `${event.sender.id}:${request.requestId}`
      const controller = new AbortController()
      aiRequests.set(id, controller)
      try { return await aiRequest(request, controller.signal) }
      finally { if (aiRequests.get(id) === controller) aiRequests.delete(id) }
    })
    ipcMain.on('desktop:ai-cancel', (event, requestId) => {
      trusted(event)
      aiRequests.get(`${event.sender.id}:${requestId}`)?.abort()
    })
    neteasePanel = createNeteasePanel({ getWindow: () => window })
    ipcMain.handle('desktop:netease-open', async (event, payload) => {
      trusted(event)
      const url = payload && typeof payload.url === 'string' ? payload.url : undefined
      const bounds = payload && typeof payload.bounds === 'object' ? payload.bounds : undefined
      return neteasePanel.open({ input: url, bounds })
    })
    ipcMain.handle('desktop:netease-navigate', async (event, payload) => {
      trusted(event)
      const url = payload && typeof payload.url === 'string' ? payload.url : ''
      return neteasePanel.navigate(url)
    })
    ipcMain.on('desktop:netease-layout', (event, bounds) => {
      trusted(event)
      neteasePanel.layout(bounds)
    })
    ipcMain.handle('desktop:netease-pause', async (event) => {
      trusted(event)
      return neteasePanel.pause()
    })
    ipcMain.handle('desktop:netease-try-play', async (event) => {
      trusted(event)
      return neteasePanel.tryPlay()
    })
    ipcMain.handle('desktop:netease-play-song', async (event, songId) => {
      trusted(event)
      return neteasePanel.playSong(typeof songId === 'string' ? songId : '')
    })
    ipcMain.handle('desktop:netease-playback-state', async (event) => {
      trusted(event)
      return neteasePanel.getPlaybackState()
    })
    ipcMain.handle('desktop:netease-toggle', async (event) => {
      trusted(event)
      return neteasePanel.togglePlayback()
    })
    ipcMain.handle('desktop:netease-fetch-liked', async (event) => {
      trusted(event)
      return neteasePanel.fetchLiked()
    })
    ipcMain.handle('desktop:netease-fetch-playlists', async (event) => {
      trusted(event)
      return neteasePanel.fetchPlaylists()
    })
    ipcMain.handle('desktop:netease-fetch-playlist-songs', async (event, playlistId) => {
      trusted(event)
      return neteasePanel.fetchPlaylistSongs(typeof playlistId === 'string' ? playlistId : '')
    })
    ipcMain.handle('desktop:netease-search', async (event, query) => {
      trusted(event)
      return neteasePanel.search(typeof query === 'string' ? query : '')
    })
    ipcMain.handle('desktop:netease-show-browser', async (event, bounds) => {
      trusted(event)
      return neteasePanel.showBrowser(bounds)
    })
    ipcMain.handle('desktop:netease-hide-browser', async (event) => {
      trusted(event)
      return neteasePanel.hideBrowser()
    })
    ipcMain.handle('desktop:netease-logged-in', async (event) => {
      trusted(event)
      return neteasePanel.isLoggedIn()
    })
    ipcMain.on('desktop:netease-close', (event) => {
      trusted(event)
      neteasePanel.close()
    })
    // 窗口缩放后由渲染端 ResizeObserver 再 sync；这里兜底保持 bounds 合法
    window.on('resize', () => {
      if (neteasePanel?.isOpen()) neteasePanel.layout(null)
    })
    window.webContents.once('destroyed', () => {
      neteasePanel?.dispose()
      neteasePanel = undefined
      for (const controller of aiRequests.values()) controller.abort()
      aiRequests.clear()
    })
    const openProject = async () => {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'SuQCanvas 项目', extensions: ['sqcanvas'] }] })
      pendingFiles.push(...result.filePaths)
      await deliverFiles()
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '文件', submenu: [
        { label: '导入项目…', accelerator: 'CmdOrCtrl+O', click: openProject },
        { label: '打开数据目录', click: () => void shell.openPath(app.getPath('userData')) },
        { type: 'separator' }, { label: '退出', role: 'close' },
      ] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: '帮助', submenu: [{ label: '检查更新…', click: () => void updater.check(true) }, { label: '关于 SuQCanvas 桌面版', click: () => void dialog.showMessageBox(window, {
        message: `SuQCanvas 桌面版 ${app.getVersion()}`, detail: '离线画布 · 本地项目 · 服务器手动同步',
      }) }] },
    ]))
    await window.loadURL(APP_URL)
  }).catch((error) => { dialog.showErrorBox('SuQCanvas 启动失败', error.message); app.quit() })
  app.on('window-all-closed', () => app.quit())
}
