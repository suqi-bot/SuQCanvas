const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { aiRequest } = require('./ai-request.cjs')

test('desktop AI transport preserves bytes and omits browser Origin', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.origin, undefined)
    assert.equal(req.headers.authorization, 'Bearer test-key')
    res.setHeader('Content-Type', 'image/png')
    res.end(Buffer.from([0, 128, 255]))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await aiRequest({ url: `http://127.0.0.1:${server.address().port}/view`, method: 'GET', key: 'test-key' })
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(response.base64, 'base64'), Buffer.from([0, 128, 255]))
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
})
test('desktop AI transport rejects filesystem access and unsupported verbs', async () => {
  await assert.rejects(aiRequest({ url: 'file:///C:/secret', method: 'GET' }))
  await assert.rejects(aiRequest({ url: 'http://localhost', method: 'DELETE' }))
})

test('desktop AI transport aborts an in-flight request', async () => {
  let received
  const started = new Promise((resolve) => { received = resolve })
  const server = http.createServer(() => received())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const controller = new AbortController()
    const pending = aiRequest({ url: `http://127.0.0.1:${server.address().port}/slow`, method: 'GET' }, controller.signal)
    const rejected = assert.rejects(pending, { name: 'AbortError' })
    await started
    controller.abort()
    await rejected
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
})
