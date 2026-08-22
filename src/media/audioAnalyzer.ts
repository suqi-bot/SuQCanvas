// 单例 Web Audio 分析器：把正在播放的 <audio> 元素接入 AnalyserNode，
// 供水波纹背景与频谱条读取实时的频率/波形数据。blob URL 同源，无 CORS 问题。
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let source: MediaElementAudioSourceNode | null = null
const wiredElements = new WeakSet<HTMLAudioElement>()

function ensureGraph(): { ctx: AudioContext; analyser: AnalyserNode } {
  if (!ctx) {
    const c = new AudioContext()
    const a = c.createAnalyser()
    a.fftSize = 512
    // 平滑值调低,频谱响应更灵敏,可视化律动更明显
    a.smoothingTimeConstant = 0.5
    a.connect(c.destination)
    ctx = c
    analyser = a
  }
  return { ctx, analyser: analyser! }
}

/**
 * 把音频元素接入分析器（每个元素只接一次）。元素接入后其输出会被改道，
 * 经由 analyser 输出到扬声器，因此音量/静音仍生效。
 */
export function wireAudioElement(el: HTMLAudioElement | null): void {
  if (!el) return
  try {
    const graph = ensureGraph()
    if (!wiredElements.has(el)) {
      source = graph.ctx.createMediaElementSource(el)
      source.connect(graph.analyser)
      wiredElements.add(el)
    }
    if (graph.ctx.state === 'suspended') void graph.ctx.resume()
  } catch {
    // 某些环境/浏览器不支持时静默降级为无音频驱动的动画
  }
}

export function getAnalyser(): AnalyserNode | null {
  try {
    return ensureGraph().analyser
  } catch {
    return null
  }
}

/** 归一化音量级（0..1），供波纹幅度使用 */
export function getAudioLevel(): number {
  const node = getAnalyser()
  if (!node) return 0
  const data = new Uint8Array(node.frequencyBinCount)
  node.getByteFrequencyData(data)
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  return data.length > 0 ? sum / data.length / 255 : 0
}
