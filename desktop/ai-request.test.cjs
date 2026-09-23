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

test('desktop image upload sends multipart image bytes and input type', async () => {
  let captured
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured = { headers: req.headers, body: Buffer.concat(chunks).toString() }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ name: 'layer-source.png', subfolder: '' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await aiRequest({ url: `http://127.0.0.1:${server.address().port}/upload/image`, method: 'POST',
      upload: { base64: Buffer.from('source-pixels').toString('base64'), name: 'source.png', type: 'image/png' } })
    assert.equal(response.status, 200)
    assert.match(captured.headers['content-type'], /^multipart\/form-data; boundary=/)
    assert.match(captured.body, /name="image"; filename="source.png"/)
    assert.match(captured.body, /source-pixels/)
    assert.match(captured.body, /name="type"\r\n\r\ninput/)
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
})

test('desktop image edit upload sends OpenAI-compatible form fields', async () => {
  let captured
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured = { headers: req.headers, body: Buffer.concat(chunks).toString() }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('out').toString('base64') }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await aiRequest({
      url: `http://127.0.0.1:${server.address().port}/images/edits`, method: 'POST', key: 'k',
      upload: {
        base64: Buffer.from('source-pixels').toString('base64'), name: 'source.png', type: 'image/png',
        fields: { prompt: 'split layers', model: 'edit-model', n: '2' },
      },
    })
    assert.equal(response.status, 200)
    assert.match(captured.body, /name="image"; filename="source.png"/)
    assert.match(captured.body, /name="prompt"\r\n\r\nsplit layers/)
    assert.match(captured.body, /name="model"\r\n\r\nedit-model/)
    assert.match(captured.body, /name="n"\r\n\r\n2/)
    assert.doesNotMatch(captured.body, /name="type"\r\n\r\ninput/)
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
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
