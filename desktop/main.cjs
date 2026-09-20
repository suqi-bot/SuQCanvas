const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require('electron')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

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
const pendingFiles = process.argv.filter((arg) => path.isAbsolute(arg) && arg.toLowerCase().endsWith('.sqcanvas'))

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
      title: 'SuQCanvas', width: 1360, height: 900, minWidth: 1000, minHeight: 680,
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
    window.on('close', (event) => {
      if (closing) return
      event.preventDefault()
      if (closeTimer) return
      window.webContents.send('desktop:before-close')
      closeTimer = setTimeout(async () => {
        closeTimer = undefined
        const { response } = await dialog.showMessageBox(window, { type: 'warning',
          message: '应用尚未确认保存完成', detail: '可以返回继续等待，或退出应用。',
          buttons: ['返回应用', '仍然退出'], defaultId: 0, cancelId: 0 })
        if (response === 1) { closing = true; window.close() }
      }, 15000)
    })
    ipcMain.on('desktop:ready', (event) => { trusted(event); rendererReady = true; void deliverFiles() })
    ipcMain.on('desktop:close-ready', (event, ok) => {
      trusted(event)
      clearTimeout(closeTimer)
      closeTimer = undefined
      if (ok) { closing = true; window.close() }
      else void dialog.showMessageBox(window, { type: 'error', message: '项目尚未保存成功或传输仍在进行，请完成后再退出。' })
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
      { label: '帮助', submenu: [{ label: '关于 SuQCanvas', click: () => void dialog.showMessageBox(window, {
        message: `SuQCanvas ${app.getVersion()}`, detail: '离线画布 · 本地项目 · 服务器手动同步',
      }) }] },
    ]))
    await window.loadURL(APP_URL)
  }).catch((error) => { dialog.showErrorBox('SuQCanvas 启动失败', error.message); app.quit() })
  app.on('window-all-closed', () => app.quit())
}
