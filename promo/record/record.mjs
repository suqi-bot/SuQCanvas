// ============================================================================
// SuQCanvas 产品宣传片 —— 真实应用录制脚本（Apple 风格，逐帧捕获方案）
// 运行：node promo/record/record.mjs [--fps 12] [--out promo/record/suqcanvas-promo.mp4]
// 前置：
//   1. 已构建在线版：npm run build:online  (dist/)
//   2. 已生成演示项目：node promo/apple/build-demo.mjs (promo/apple/demo.sqcanvas)
//   3. 已启动静态服务器：node promo/record/serve-dist.mjs 4413
// 说明：本脚本驱动真实 SuQCanvas（游客模式），按时间轴执行运镜/真实操作/Apple 字幕卡，
//       用 page.screenshot 逐帧捕获（规避 Playwright recordVideo 的黑场问题），
//       ffmpeg 合成 mp4 并混入背景音乐。
// ============================================================================
import { chromium } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const FRAME_DIR = path.join(__dirname, 'frames_cap')
const BRIDGE = fs.readFileSync(path.join(__dirname, 'promo-bridge.js'), 'utf8')
const DEMO = path.join(__dirname, '..', 'apple', 'demo.sqcanvas')
const PORT = Number(process.env.PROMO_PORT || 4413)
const BASE = `http://127.0.0.1:${PORT}/SuQCanvas/`
const BGM = process.env.PROMO_BGM || path.join(__dirname, 'bgm.wav')

const args = process.argv.slice(2)
function argVal(name, def) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const FPS = Number(argVal('--fps', '12'))
const OUT = path.resolve(argVal('--out', path.join(__dirname, 'suqcanvas-promo.mp4')))
const CAPTURE_ONLY = args.includes('--capture-only')

// ---------------- 工具 ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 节拍器：以固定 fps 捕获帧，从 t0 开始
function makeCaptureLoop(page, fps) {
  const interval = 1000 / fps
  let t0 = null
  let idx = 0
  let stopped = false
  async function tick() {
    if (stopped) return
    const now = Date.now()
    if (t0 === null) t0 = now
    const elapsed = now - t0
    if (elapsed >= interval * idx) {
      const p = path.join(FRAME_DIR, `f_${String(idx).padStart(4, '0')}.jpg`)
      // JPEG 截图远快于 PNG，可跟上 12fps
      await page.screenshot({ path: p, type: 'jpeg', quality: 85 })
      idx++
    }
    if (!stopped) setTimeout(tick, Math.max(1, interval - (Date.now() - t0 - idx * interval)))
  }
  tick()
  return {
    stop: () => {
      stopped = true
    },
    get count() {
      return idx
    },
  }
}

// ============================================================================
// 主流程
// ============================================================================
fs.rmSync(FRAME_DIR, { recursive: true, force: true })
fs.mkdirSync(FRAME_DIR, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.setItem('sq:guest', '1')
  localStorage.setItem('suqcanvas:theme', 'dark')
})
await page.addInitScript(new Function(BRIDGE))
page.on('pageerror', (e) => console.warn('[pageerror]', e.message))

console.log('▶ 加载真实应用...')
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.react-flow', { timeout: 20000 })
await page.waitForTimeout(1500)

console.log('▶ 打开项目首页并导入演示项目...')
await page.getByRole('button', { name: '未命名项目' }).first().click().catch(() => {})
await page.waitForTimeout(700)
await page.locator('input[accept*=".sqcanvas"]').first().setInputFiles(DEMO)
await page.waitForTimeout(3200)
await page.waitForSelector('.react-flow__node', { timeout: 20000 })
await page.waitForTimeout(1200)

// 隐藏 attributions 让画面更纯净
await page.evaluate(() => {
  const a = document.querySelector('.react-flow__attribution')
  if (a) a.style.display = 'none'
})

// 辅助函数
const readCam = () => page.evaluate(() => window.__promo.cam.read())
const focusNode = (nodeId, scale, duration = 1400) =>
  page.evaluate(
    ({ nodeId, scale, duration }) => {
      const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)
      if (el) window.__promo.cam.focus(el, scale, duration)
    },
    { nodeId, scale, duration },
  )
const glideTo = (s, tx, ty, duration = 1400) =>
  page.evaluate(({ s, tx, ty, duration }) => window.__promo.cam.glide(s, tx, ty, duration), {
    s,
    tx,
    ty,
    duration,
  })
const fitView = async () => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sq:view', { detail: { action: 'fit' } })))
  await sleep(700)
}
const title = (text, opts = {}) =>
  page.evaluate(
    ({ text, opts }) => {
      window.__lastTitle = window.__promo.title(text, opts)
    },
    { text, opts },
  )
const clearTitle = (ms = 600) =>
  page.evaluate((ms) => {
    if (window.__lastTitle) {
      window.__lastTitle.remove(ms)
      window.__lastTitle = null
    }
  }, ms)
const blank = () =>
  page.evaluate(() => {
    window.__blank = window.__promo.blank()
  })
const clearBlank = (ms = 500) =>
  page.evaluate((ms) => {
    if (window.__blank) {
      window.__blank.clear(ms)
      window.__blank = null
    }
  }, ms)

// 启动捕获
console.log(`▶ 开始捕获 @ ${FPS}fps ...`)
const loop = makeCaptureLoop(page, FPS)

// ============================================================================
// 剧本（时间轴）—— Apple 式慢节奏
// ============================================================================
const D = (sec) => sec * 1000

// --- 镜头 1：黑场开场 ---
await blank()
await sleep(D(0.6))
await title('SuQCanvas', { size: 132, sub: '无限画布 · 万物皆可连线', color: '#f8fafc' })
await sleep(D(3.0))
await clearTitle(600)
await sleep(D(0.5))
await clearBlank(1000)
await sleep(D(1.2))

// --- 镜头 2：无限画布（全画布适应视图）---
await fitView()
await sleep(D(0.5))
await title('无限画布', { size: 92, sub: 'INFINITE CANVAS', color: '#f8fafc' })
await sleep(D(3.2))
await clearTitle()
await sleep(D(0.5))

// --- 镜头 3：多媒体元素蒙太奇 ---
await title('多媒体元素', { size: 78, sub: '拖入即用', color: '#f8fafc' })
await sleep(D(1.8))
await clearTitle()
const mediaShots = [
  { id: 'n-img-1', scale: 1.8 },
  { id: 'n-vd-1', scale: 1.7 },
  { id: 'n-img-2', scale: 1.8 },
  { id: 'n-img-3', scale: 1.8 },
  { id: 'n-img-4', scale: 1.8 },
]
for (const [i, s] of mediaShots.entries()) {
  await focusNode(s.id, s.scale, 1600)
  await sleep(D(1.9))
  if (i === 1) {
    // 聚焦视频节点后提示
    await title('视频 · 音频 · PDF · Markdown', { size: 58, sub: '任意格式', color: '#f8fafc' })
    await sleep(D(2.0))
    await clearTitle()
    await sleep(D(0.4))
  }
}

// --- 镜头 4：连线系统 ---
await focusNode('n-img-1', 1.15, 1400)
await sleep(D(0.8))
await title('连线系统', { size: 78, sub: '组织你的想法', color: '#f8fafc' })
await sleep(D(2.4))
await clearTitle()
await focusNode('n-t-keywords', 1.3, 1400)
await sleep(D(1.0))
// 选中一条边展示 Inspector
await page.evaluate(() => {
  const el = document.querySelector('[data-id="e2"]')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }))
})
await sleep(D(2.2))
// 隐藏 inspector，回到干净画布
await page.evaluate(() => {
  const pane = document.querySelector('.react-flow__pane')
  if (pane) pane.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }))
})
await sleep(D(0.6))

// --- 镜头 5：Markdown / PDF ---
await focusNode('n-md-notes', 1.4, 1400)
await sleep(D(1.0))
await title('Markdown · PDF', { size: 66, sub: '文档即时呈现', color: '#f8fafc' })
await sleep(D(2.4))
await clearTitle()
await sleep(D(0.5))

// --- 镜头 6：音频播放器 ---
await focusNode('n-au-1', 1.7, 1400)
await sleep(D(0.9))
// 点击音频节点（播放）
await page.evaluate(() => {
  const el = document.querySelector('.react-flow__node[data-id="n-au-1"]')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }))
})
await sleep(D(1.6))
await title('内置播放器', { size: 66, sub: 'MP3 · WAV · OGG', color: '#f8fafc' })
await sleep(D(2.4))
await clearTitle()
await sleep(D(0.5))

// --- 镜头 7：主题切换 ---
await fitView()
await sleep(D(0.6))
await title('双主题', { size: 78, sub: '一键切换', color: '#f8fafc' })
await sleep(D(2.0))
await clearTitle()
// 黑场过渡，避免深色直接跳到极亮白色
await blank()
await sleep(D(0.6))
await clearBlank(400)
await page.getByRole('button', { name: '切换到白色主题' }).first().click()
await sleep(D(1.8))
// 切回深色（同样用黑场过渡）
await blank()
await sleep(D(0.6))
await clearBlank(400)
await page.getByRole('button', { name: '切换到深色主题' }).first().click()
await sleep(D(1.4))

// --- 镜头 8：结尾 ---
await fitView()
await sleep(D(0.5))
await title('拖入文件 · 连起关系 · 自动保存', { size: 60, sub: '本地优先 · 数据不出浏览器', color: '#f8fafc' })
await sleep(D(2.6))
await clearTitle()
await sleep(D(0.4))
await title('SuQCanvas', { size: 132, sub: '无限画布 · 万物皆可连线', color: '#38bdf8' })
await sleep(D(3.0))

// 收尾
await sleep(D(0.5))
loop.stop()
await sleep(400)
console.log('▶ 剧本完成，共捕获', loop.count, '帧')
await browser.close()

if (CAPTURE_ONLY) {
  console.log('CAPTURE_ONLY 模式，跳过编码。帧目录:', FRAME_DIR)
  process.exit(0)
}

// ============================================================================
// ffmpeg 合成 mp4 + 背景音乐
// ============================================================================
const ffmpeg = findFfmpeg()
if (!ffmpeg) {
  console.error('未找到 ffmpeg')
  process.exit(1)
}
console.log('▶ 编码 mp4...')

// 先合成无声视频
const videoOnly = path.join(__dirname, '_video-only.mp4')
fs.rmSync(videoOnly, { force: true })
execFileSync(
  ffmpeg,
  ['-y', '-framerate', String(FPS), '-i', path.join(FRAME_DIR, 'f_%04d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', videoOnly],
  { stdio: 'inherit' },
)

// 混入背景音乐（若存在）
fs.rmSync(OUT, { force: true })
if (fs.existsSync(BGM)) {
  try {
    execFileSync(
      ffmpeg,
      ['-y', '-i', videoOnly, '-i', BGM, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', OUT],
      { stdio: 'inherit' },
    )
  } catch {
    console.warn('混流背景音乐失败，输出无声视频')
    fs.copyFileSync(videoOnly, OUT)
  }
} else {
  fs.copyFileSync(videoOnly, OUT)
}
console.log('输出:', OUT)

function findFfmpeg() {
  const candidates = []
  try {
    const p = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/)[0]
    if (p && fs.existsSync(p.trim())) candidates.push(p.trim())
  } catch {}
  const wingetBase = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  if (fs.existsSync(wingetBase)) {
    for (const name of fs.readdirSync(wingetBase)) {
      if (!name.toLowerCase().startsWith('gyan.ffmpeg') && !name.toLowerCase().startsWith('btbn.ffmpeg')) continue
      const p = findExe(path.join(wingetBase, name), 'ffmpeg.exe')
      if (p) candidates.push(p)
    }
  }
  return candidates[0] || null
}

function findExe(dir, target) {
  if (!fs.existsSync(dir)) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findExe(p, target)
      if (found) return found
    } else if (entry.name.toLowerCase() === target) {
      return p
    }
  }
  return null
}
