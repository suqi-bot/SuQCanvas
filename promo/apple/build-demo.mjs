// 生成演示项目 demo.sqcanvas：真实媒体素材 + 精心布局的灵感板
// 运行：node promo/apple/build-demo.mjs（cwd = 项目根目录）
import fs from 'node:fs'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const ROOT = process.cwd()
const APPLE = path.join(ROOT, 'promo', 'apple')
const PHOTOS = path.join(APPLE, 'work', 'photos')
const OUT = path.join(APPLE, 'demo.sqcanvas')

const photoFiles = ['p1015.jpg', 'p1016.jpg', 'p1018.jpg', 'p1035.jpg', 'p1036.jpg', 'p1039.jpg']
const photoLabels = ['灵感·山谷.jpg', '灵感·峡谷.jpg', '灵感·湖泊.jpg', '灵感·晨雾.jpg', '灵感·雪峰.jpg', '灵感·森林.jpg']

const markdownText = `# 产品介绍片 · 笔记

## 节奏设计

- 开场：黑场与品牌浮现
- 中段：功能蒙太奇，硬切为主
- 结尾：回归品牌与留白

## 转场参考

- Apple 发布会：慢推近、大字排版
- 克制的动效，画面自己说话
`

function makePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // stream 占位
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const stream = 'BT /F1 24 Tf 72 700 Td (SuQCanvas Intro Script v3) Tj ET'
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, i) => {
    offsets.push(pdf.length)
    if (obj === null) {
      pdf += `${i + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    } else {
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
    }
  })
  const xrefPos = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return strToU8(pdf)
}

// ---------- 节点 ----------
const P = (x, y) => ({ x, y })
const nodes = []

nodes.push({
  id: 'n-h-main', type: 'heading', position: P(60, 70), width: 420, height: 64,
  data: { kind: 'heading', level: 1, label: '标题 1', text: 'SuQCanvas · 灵感板', borderColor: '#64748b' },
})

// 照片行 1
photoFiles.slice(0, 4).forEach((f, i) => {
  nodes.push({
    id: `n-img-${i + 1}`, type: 'image', position: P(60 + i * 520, 220), width: 480, height: 320,
    data: { kind: 'image', assetId: `a-img-${i + 1}`, label: photoLabels[i], fileSize: 0, mime: 'image/jpeg', borderColor: '#64748b' },
  })
})
// 照片行 2
photoFiles.slice(4).forEach((f, i) => {
  nodes.push({
    id: `n-img-${i + 5}`, type: 'image', position: P(60 + i * 520, 610), width: 480, height: 320,
    data: { kind: 'image', assetId: `a-img-${i + 5}`, label: photoLabels[i + 4], fileSize: 0, mime: 'image/jpeg', borderColor: '#64748b' },
  })
})

nodes.push({
  id: 'n-t-keywords', type: 'text', position: P(1100, 610), width: 480, height: 150,
  data: { kind: 'text', label: '文本', text: '关键词\n极简 · 留白 · 克制的动效\n深色界面 · 本地优先', borderColor: '#38bdf8', fontSize: 16 },
})
nodes.push({
  id: 'n-t-quote', type: 'text', position: P(1100, 800), width: 480, height: 96,
  data: { kind: 'text', label: '文本', text: '“好的产品，像一场安静的发布会。”', borderColor: '#f472b6', fontSize: 20, italic: true },
})
nodes.push({
  id: 'n-md-notes', type: 'markdown', position: P(1620, 610), width: 480, height: 310,
  data: { kind: 'markdown', assetId: 'a-md', label: '产品介绍片·笔记.md', fileSize: 0, mime: 'text/markdown', borderColor: '#a78bfa' },
})
nodes.push({
  id: 'n-st-1', type: 'sticky', position: P(60, 1030), width: 200, height: 160,
  data: { kind: 'sticky', color: 'yellow', label: '便签', text: '周六前\n完成首版概念稿', borderColor: '#f59e0b', fontSize: 14 },
})
nodes.push({
  id: 'n-st-2', type: 'sticky', position: P(300, 1030), width: 200, height: 160,
  data: { kind: 'sticky', color: 'pink', label: '便签', text: '参考\nApple 发布会转场', borderColor: '#ec4899', fontSize: 14 },
})
nodes.push({
  id: 'n-st-3', type: 'sticky', position: P(540, 1030), width: 200, height: 160,
  data: { kind: 'sticky', color: 'blue', label: '便签', text: '配乐方向\n极简钢琴＋环境音', borderColor: '#3b82f6', fontSize: 14 },
})
nodes.push({
  id: 'n-sh-1', type: 'shape', position: P(1100, 1020), width: 180, height: 120,
  data: { kind: 'shape', shape: 'ellipse', label: '椭圆', text: '核心', fill: '#38bdf8', borderColor: '#0ea5e9', textAlign: 'center', textAlignV: 'middle', fontSize: 15 },
})
nodes.push({
  id: 'n-sh-2', type: 'shape', position: P(1330, 1020), width: 180, height: 120,
  data: { kind: 'shape', shape: 'rect', label: '矩形', text: '迭代', fill: '#a78bfa', borderColor: '#8b5cf6', textAlign: 'center', textAlignV: 'middle', fontSize: 15 },
})
nodes.push({
  id: 'n-au-1', type: 'audio', position: P(780, 1085), width: 280, height: 72,
  data: { kind: 'audio', assetId: 'a-audio', label: 'ambient-demo.wav', fileSize: 0, mime: 'audio/wav', borderColor: '#34d399' },
})
nodes.push({
  id: 'n-vd-1', type: 'video', position: P(1620, 240), width: 480, height: 270,
  data: { kind: 'video', assetId: 'a-video', label: 'demo-video.mp4', fileSize: 0, mime: 'video/mp4', borderColor: '#a78bfa' },
})
nodes.push({
  id: 'n-fc-1', type: 'fileCard', position: P(1620, 1020), width: 260, height: 96,
  data: { kind: 'file', assetId: 'a-pdf', label: '产品介绍片脚本 v3.pdf', fileSize: 0, mime: 'application/pdf', borderColor: '#94a3b8' },
})

// ---------- 连线 ----------
const E = (id, source, target, stroke, arrow = 'end') => ({
  id, source, target, type: 'styled',
  data: { style: { lineStyle: 'solid', pathType: 'bezier', arrow, stroke, strokeWidth: 2 } },
})
const edges = [
  E('e1', 'n-h-main', 'n-img-1', '#64748b', 'none'),
  E('e2', 'n-img-1', 'n-t-keywords', '#38bdf8'),
  E('e3', 'n-img-2', 'n-st-2', '#f472b6'),
  E('e4', 'n-img-3', 'n-t-quote', '#34d399'),
  E('e5', 'n-img-5', 'n-st-3', '#38bdf8'),
  E('e6', 'n-img-6', 'n-fc-1', '#94a3b8'),
  E('e7', 'n-st-1', 'n-t-keywords', '#fbbf24'),
  E('e8', 'n-t-keywords', 'n-md-notes', '#64748b'),
  E('e9', 'n-md-notes', 'n-sh-1', '#a78bfa'),
  E('e10', 'n-sh-1', 'n-sh-2', '#94a3b8'),
  E('e11', 'n-t-quote', 'n-st-1', '#fb7185'),
]

// ---------- 素材 ----------
const files = {}
const assets = []

for (const [i, f] of photoFiles.entries()) {
  const buf = fs.readFileSync(path.join(PHOTOS, f))
  const id = `a-img-${i + 1}`
  files[`assets/${id}.bin`] = buf
  assets.push({ id, name: photoLabels[i], mime: 'image/jpeg', size: buf.length, kind: 'image', hasThumbnail: false })
  const node = nodes.find((n) => n.id === `n-img-${i + 1}`)
  node.data.fileSize = buf.length
}

const mdBytes = strToU8(markdownText)
files['assets/a-md.bin'] = mdBytes
assets.push({ id: 'a-md', name: '产品介绍片·笔记.md', mime: 'text/markdown', size: mdBytes.length, kind: 'markdown', hasThumbnail: false })
nodes.find((n) => n.id === 'n-md-notes').data.fileSize = mdBytes.length

const pdfBytes = makePdf()
files['assets/a-pdf.bin'] = pdfBytes
assets.push({ id: 'a-pdf', name: '产品介绍片脚本 v3.pdf', mime: 'application/pdf', size: pdfBytes.length, kind: 'file', hasThumbnail: false })
nodes.find((n) => n.id === 'n-fc-1').data.fileSize = pdfBytes.length

const wavPath = path.join(APPLE, 'work', 'ambient-demo.wav')
if (fs.existsSync(wavPath)) {
  const wav = fs.readFileSync(wavPath)
  files['assets/a-audio.bin'] = wav
  assets.push({ id: 'a-audio', name: 'ambient-demo.wav', mime: 'audio/wav', size: wav.length, kind: 'audio', hasThumbnail: false })
  nodes.find((n) => n.id === 'n-au-1').data.fileSize = wav.length
}

const videoPath = path.join(APPLE, 'work', 'demo-video.mp4')
if (fs.existsSync(videoPath)) {
  const vbuf = fs.readFileSync(videoPath)
  files['assets/a-video.bin'] = vbuf
  assets.push({ id: 'a-video', name: 'demo-video.mp4', mime: 'video/mp4', size: vbuf.length, kind: 'video', hasThumbnail: false })
  nodes.find((n) => n.id === 'n-vd-1').data.fileSize = vbuf.length
}

const json = {
  format: 'sqcanvas',
  version: 1,
  project: { name: 'SuQCanvas 灵感板' },
  viewport: { x: 40, y: 60, zoom: 0.55 },
  nodes,
  edges,
  assets,
}
files['project.json'] = strToU8(JSON.stringify(json))

const zipped = zipSync(files, { level: 6 })
fs.writeFileSync(OUT, zipped)
fs.writeFileSync(path.join(APPLE, 'work', 'demo-project.json'), JSON.stringify(json, null, 2))
console.log('已生成', OUT, `(${zipped.length} bytes)`, nodes.length, '节点', edges.length, '连线', assets.length, '素材')
