const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdater } = require('./updater.cjs')

function setup({ available = true, responses = [0, 0], fail = false } = {}) {
  const calls = { dialogs: [], downloads: 0, saveRequests: 0, installs: 0, checks: 0 }
  const autoUpdater = Object.assign(new EventEmitter(), {
    async checkForUpdates() {
      calls.checks++
      if (fail) throw new Error('offline')
      return { isUpdateAvailable: available, updateInfo: { version: '1.4.0' } }
    },
    async downloadUpdate() { calls.downloads++ },
    quitAndInstall() { calls.installs++ },
  })
  const updater = createUpdater({
    app: { isPackaged: true, getVersion: () => '1.3.0' },
    window: { setProgressBar() {}, setTitle() {} },
    dialog: { async showMessageBox(_window, options) {
      calls.dialogs.push(options)
      return { response: responses.shift() ?? 1 }
    } },
    autoUpdater, requestInstall() { calls.saveRequests++ },
  })
  return { updater, autoUpdater, calls }
}
test('download requires consent and install waits for save confirmation', async () => {
  const { updater, autoUpdater, calls } = setup()
  await updater.check()
  assert.equal(calls.downloads, 1)
  assert.equal(calls.saveRequests, 1)
  assert.equal(calls.installs, 0)
  assert.equal(autoUpdater.autoInstallOnAppQuit, false)
  updater.install()
  assert.equal(calls.installs, 1)
})
test('declining update never downloads or installs', async () => {
  const { updater, calls } = setup({ responses: [1] })
  await updater.check()
  updater.install()
  assert.equal(calls.downloads, 0)
  assert.equal(calls.installs, 0)
})
test('no update is silent automatically and visible on manual check', async () => {
  const { updater, calls } = setup({ available: false })
  await updater.check()
  assert.equal(calls.dialogs.length, 0)
  await updater.check(true)
  assert.equal(calls.dialogs.length, 1)
  assert.equal(calls.downloads, 0)
})
test('offline startup is silent; manual checks show a recoverable error', async () => {
  const { updater, calls } = setup({ fail: true })
  await updater.check()
  assert.equal(calls.dialogs.length, 0)
  await updater.check(true)
  assert.match(calls.dialogs[0].message, /无法检查/)
})
test('deferred installation can be requested again without another download', async () => {
  const { updater, calls } = setup({ responses: [0, 1, 0] })
  await updater.check()
  assert.equal(calls.saveRequests, 0)
  await updater.check(true)
  assert.equal(calls.saveRequests, 1)
  assert.equal(calls.downloads, 1)
  assert.equal(calls.checks, 1)
})
