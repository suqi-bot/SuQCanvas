// HTTP transport for the trusted desktop renderer. Never forwards cookies or follows redirects.
async function aiRequest(request) {
  const url = new URL(request.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持 HTTP(S) 地址')
  if (!['GET', 'POST'].includes(request.method)) throw new Error('不支持的请求方式')
  const headers = {}
  if (request.key) headers.Authorization = `Bearer ${request.key}`
  if (request.body) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, { method: request.method, headers, body: request.body,
    redirect: 'error', signal: AbortSignal.timeout(180000) })
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 64 * 1024 * 1024) throw new Error('AI 响应超过 64MB')
    chunks.push(chunk)
  }
  return { status: response.status, contentType: response.headers.get('content-type') || '',
    base64: Buffer.concat(chunks).toString('base64') }
}
module.exports = { aiRequest }
