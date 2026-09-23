// 点歌链路冒烟：导航到目标 song id + 可读播放状态（无需登录也能验证 hash）
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { createNeteasePanel, buildPlaySongScript } = require(path.join(__dirname, '../desktop/netease.cjs'))

if (!buildPlaySongScript('1')) {
  console.error('FAIL buildPlaySongScript')
  process.exitCode = 1
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { backgroundThrottling: false },
  })
  const panel = createNeteasePanel({ getWindow: () => win })
  const idA = '26168287'
  const idB = '186016'
  try {
    const a = await panel.playSong(idA)
    const b = await panel.playSong(idB)
    const fail = (msg, data) => {
      console.error('FAIL', msg, JSON.stringify(data))
      process.exitCode = 1
    }
    if (!a || a.actualId !== idA) fail('A not routed', a)
    else console.log('OK A routed', a.stage, a.hash)
    if (!b || b.actualId !== idB) fail('B not routed to expected id', b)
    else console.log('OK B routed', b.stage, b.actualId, b.hash)
    if (a && b && a.actualId === b.actualId && a.actualId) {
      fail('A and B same id — navigation not switching', { a, b })
    }
    // 隐藏后仍能读状态（离屏 parked）
    panel.hideBrowser()
    const state = await panel.getPlaybackState()
    if (!state || typeof state.playing !== 'boolean') fail('getPlaybackState bad shape', state)
    else console.log('OK state', JSON.stringify(state))
    const toggled = await panel.togglePlayback()
    if (!toggled || typeof toggled.ok !== 'boolean') fail('toggle bad shape', toggled)
    else console.log('OK toggle', JSON.stringify(toggled))
  } catch (error) {
    console.error('FAIL exception', error)
    process.exitCode = 1
  } finally {
    panel.dispose()
    win.destroy()
    app.quit()
  }
})

app.on('window-all-closed', () => app.quit())
