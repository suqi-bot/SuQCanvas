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
  readAiCredentials: () => ipcRenderer.invoke('desktop:read-ai-credentials'),
  writeAiCredentials: (credentials) => ipcRenderer.invoke('desktop:write-ai-credentials', credentials),
  neteaseOpen: (payload) => ipcRenderer.invoke('desktop:netease-open', payload),
  neteaseNavigate: (payload) => ipcRenderer.invoke('desktop:netease-navigate', payload),
  neteaseLayout: (bounds) => ipcRenderer.send('desktop:netease-layout', bounds),
  neteasePause: () => ipcRenderer.invoke('desktop:netease-pause'),
  neteaseTryPlay: () => ipcRenderer.invoke('desktop:netease-try-play'),
  neteasePlaySong: (songId) => ipcRenderer.invoke('desktop:netease-play-song', songId),
  neteasePlaybackState: () => ipcRenderer.invoke('desktop:netease-playback-state'),
  neteaseToggle: () => ipcRenderer.invoke('desktop:netease-toggle'),
  neteaseSeekTo: (time) => ipcRenderer.invoke('desktop:netease-seek-to', time),
  neteaseFetchLiked: () => ipcRenderer.invoke('desktop:netease-fetch-liked'),
  neteaseFetchPlaylists: () => ipcRenderer.invoke('desktop:netease-fetch-playlists'),
  neteaseFetchPlaylistSongs: (playlistId) => ipcRenderer.invoke('desktop:netease-fetch-playlist-songs', playlistId),
  neteaseSearch: (query) => ipcRenderer.invoke('desktop:netease-search', query),
  neteaseShowBrowser: (bounds) => ipcRenderer.invoke('desktop:netease-show-browser', bounds),
  neteaseHideBrowser: () => ipcRenderer.invoke('desktop:netease-hide-browser'),
  neteaseLoggedIn: () => ipcRenderer.invoke('desktop:netease-logged-in'),
  neteaseClose: () => ipcRenderer.send('desktop:netease-close'),
})
