// ============================================================================
// 一键录制 SuQCanvas 宣传片（可复用流水线入口）
// 用法：node promo/record/run.mjs [--fps 12] [--out promo/record/suqcanvas-promo.mp4]
// 流程：构建在线版 -> 生成演示项目 -> 启动静态服务器 -> 录制并编码 -> 停止服务器
// 说明：需要已安装 ffmpeg（可用 winget install Gyan.FFmpeg）
// ============================================================================
import { spawnSync, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const PORT = 4413

const args = process.argv.slice(2)
function argVal(name, def) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const FPS = Number(argVal('--fps', '12'))
const OUT = path.resolve(argVal('--out', path.join(__dirname, 'suqcanvas-promo.mp4')))
const SKIP_BUILD = args.includes('--skip-build')

function run(cmd, argv, opts = {}) {
  console.log(`\n▶ ${cmd} ${argv.join(' ')}`)
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', ...opts })
  if (r.status !== 0) {
    console.error(`✗ 失败 (${cmd})`)
    process.exit(r.status ?? 1)
  }
}

// 1. 构建在线版
if (!SKIP_BUILD) {
  run('npm', ['run', 'build:online'])
} else {
  console.log('▶ 跳过构建（--skip-build）')
}

// 2. 生成演示项目（含视频节点）
run('node', ['promo/apple/build-demo.mjs'])

// 3. 生成背景音乐（若无）
const bgm = path.join(__dirname, 'bgm.wav')
if (!fs.existsSync(bgm)) {
  console.log('▶ 生成背景音乐 bgm.wav')
  run('ffmpeg', [
    '-y', '-stream_loop', '6', '-i', path.join(ROOT, 'promo/apple/work/ambient-demo.wav'),
    '-af', 'afade=t=in:st=0:d=2.5,afade=t=out:st=56:d=4,volume=0.85', '-t', '60',
    '-ac', '2', '-ar', '44100', bgm,
  ])
} else {
  console.log('▶ bgm.wav 已存在')
}

// 4. 启动静态服务器（后台子进程）
const serveScript = path.join(__dirname, 'serve-dist.mjs')
const serverProc = spawn(process.execPath, [serveScript, String(PORT)], {
  cwd: __dirname,
  stdio: 'inherit',
  detached: false,
})
// 等待服务器就绪
await waitForServer(`http://127.0.0.1:${PORT}/SuQCanvas/`, 15)

// 5. 录制
run('node', [
  path.join(__dirname, 'record.mjs'),
  '--fps', String(FPS),
  '--out', OUT,
])

// 6. 停止服务器
console.log('\n▶ 停止静态服务器...')
try {
  await new Promise((resolve) => {
    http
      .get(`http://127.0.0.1:${PORT}/__shutdown__`, () => resolve())
      .on('error', () => resolve())
  })
} catch {
  // ignore
}

console.log('\n✔ 完成！视频输出：', OUT)

async function waitForServer(url, seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        http
          .get(url, (res) => {
            res.resume()
            resolve()
          })
          .on('error', reject)
      })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  console.warn('⚠ 服务器未在预期时间内就绪，继续尝试...')
}
