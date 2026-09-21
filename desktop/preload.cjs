const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
contextBridge.exposeInMainWorld('suqDesktop', {
  ready: () => ipcRenderer.send('desktop:ready'),
  aiRequest: (request) => ipcRenderer.invoke('desktop:ai-request', request),
  cancelAiRequest: (requestId) => ipcRenderer.send('desktop:ai-cancel', requestId),
  onOpenProject: (callback) => subscribe('desktop:open-project', callback),
  onBeforeClose: (callback) => subscribe('desktop:before-close', callback),
  closeReady: (ok) => ipcRenderer.send('desktop:close-ready', ok === true),
  saveFile: (name, bytes) => ipcRenderer.invoke('desktop:save-file', name, bytes),
  showDataDirectory: () => ipcRenderer.invoke('desktop:show-data'),
})
