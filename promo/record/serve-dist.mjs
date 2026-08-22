// 轻量静态服务器：把 /SuQCanvas/ 前缀映射到项目 dist/，并优先 127.0.0.1
// 用途：为 Playwright 录制真实应用提供稳定、无 Vite 的静态服务。
// 用法：node serve-dist.mjs [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..') // D:\tool\SuQCanvas
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.argv[2]) || 4413

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function safeDecode(urlPath) {
  try {
    return decodeURIComponent(urlPath)
  } catch {
    return urlPath
  }
}

const server = http.createServer((req, res) => {
  // 供 run.mjs 一键脚本优雅停止
  if (req.url === '/__shutdown__') {
    res.writeHead(200)
    res.end('ok')
    setTimeout(() => server.close(() => process.exit(0)), 50)
    return
  }
  let urlPath = safeDecode(req.url.split('?')[0])
  // 剥离 /SuQCanvas 前缀（构建 base 为 /SuQCanvas/）
  const prefix = '/SuQCanvas'
  if (urlPath === prefix || urlPath.startsWith(prefix + '/')) {
    urlPath = urlPath.slice(prefix.length) || '/'
  }
  // 规范化为绝对路径并防目录穿越
  const decoded = urlPath
  const rel = decoded.replace(/^\/+/, '')
  let filePath = path.resolve(DIST, rel)
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    // SPA 回退到 index.html
    filePath = path.join(DIST, 'index.html')
  }
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[serve-dist] http://127.0.0.1:${PORT}/SuQCanvas/  -> ${DIST}`)
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
