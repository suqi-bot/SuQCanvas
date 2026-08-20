export interface LyricLine {
  time: number
  text: string
}

export interface LyricsData {
  kind: 'synced' | 'unsynced'
  lines: LyricLine[]
  source: 'lrc' | 'id3'
  offsetMs: number
  meta: Record<string, string>
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

export function parseLrc(content: string): LyricsData | undefined {
  const lines: LyricLine[] = []
  const meta: Record<string, string> = {}
  let offsetMs = 0
  for (const raw of content.replace(/\r/g, '').split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const metaMatch = /^\[(ti|ar|al|by|re|ve|offset):(.*)\]$/i.exec(trimmed)
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase()
      if (key === 'offset') offsetMs = Number.parseInt(metaMatch[2], 10) || 0
      else meta[key] = metaMatch[2].trim()
      continue
    }
    const times: number[] = []
    TIME_TAG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TIME_TAG.exec(trimmed)) !== null) {
      const digits = match[3] ?? ''
      const fraction = digits ? Number(digits) / 10 ** digits.length : 0
      times.push(Number(match[1]) * 60 + Number(match[2]) + fraction)
    }
    if (times.length === 0) continue
    TIME_TAG.lastIndex = 0
    const text = trimmed.replace(TIME_TAG, '').trim()
    for (const time of times) lines.push({ time, text })
  }
  if (lines.length === 0) return undefined
  lines.sort((a, b) => a.time - b.time)
  return { kind: 'synced', lines, source: 'lrc', offsetMs, meta }
}

function syncsafe(bytes: Uint8Array, start: number): number {
  return (
    ((bytes[start] & 0x7f) << 21) |
    ((bytes[start + 1] & 0x7f) << 14) |
    ((bytes[start + 2] & 0x7f) << 7) |
    (bytes[start + 3] & 0x7f)
  )
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  if (encoding === 3) return new TextDecoder('utf-8').decode(bytes)
  if (encoding === 1 || encoding === 2) {
    let data = bytes
    let label: string
    if (encoding === 1 && data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
      label = 'utf-16le'
      data = data.subarray(2)
    } else if (encoding === 1 && data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
      label = 'utf-16be'
      data = data.subarray(2)
    } else {
      label = encoding === 1 ? 'utf-16le' : 'utf-16be'
    }
    if (data.length % 2 === 1) data = data.subarray(0, data.length - 1)
    return new TextDecoder(label).decode(data).replace(/^\uFEFF/, '')
  }
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

function splitDescriptor(data: Uint8Array, encoding: number): { text: string; rest: Uint8Array } {
  let end = data.length
  if (encoding === 1 || encoding === 2) {
    for (let i = 0; i + 1 < data.length; i += 2) {
      if (data[i] === 0 && data[i + 1] === 0) {
        end = i
        break
      }
    }
    if (end % 2 === 1) end += 1
    return { text: decodeText(data.subarray(0, end), encoding), rest: data.subarray(end + 2) }
  }
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      end = i
      break
    }
  }
  return { text: decodeText(data.subarray(0, end), encoding), rest: data.subarray(end + 1) }
}

function parseUslt(data: Uint8Array): string {
  if (data.length < 4) return ''
  const encoding = data[0]
  const payload = data.subarray(4)
  const { rest } = splitDescriptor(payload, encoding)
  return decodeText(rest, encoding).replace(/\0+$/, '')
}

function parseSylt(data: Uint8Array): LyricLine[] | undefined {
  if (data.length < 7) return undefined
  const encoding = data[0]
  const timeFormat = data[4]
  const payload = data.subarray(7)
  const { rest } = splitDescriptor(payload, encoding)
  const lines: LyricLine[] = []
  let offset = 0
  while (offset + 4 <= rest.length) {
    const { text, rest: afterText } = splitDescriptor(rest.subarray(offset), encoding)
    const consumed = rest.length - afterText.length
    offset += consumed
    if (offset + 4 > rest.length) break
    const timestamp = (rest[offset] << 24) | (rest[offset + 1] << 16) | (rest[offset + 2] << 8) | rest[offset + 3]
    offset += 4
    const time = timeFormat === 2 ? timestamp / 100 : timestamp / 1000
    if (text) lines.push({ time, text })
  }
  return lines.length > 0 ? lines : undefined
}

export async function extractId3Lyrics(blob: Blob): Promise<LyricsData | undefined> {
  const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer())
  if (head.length < 10) return undefined
  const isId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33
  if (!isId3) return undefined
  const version = head[3]
  const flags = head[4]
  const tagSize = syncsafe(head, 6)
  const footerSize = (flags & 0x10) !== 0 ? 10 : 0
  const total = Math.min(10 + tagSize + footerSize, 8 * 1024 * 1024)
  const tag = new Uint8Array(await blob.slice(0, total).arrayBuffer())
  const useSyncsafe = version === 4
  let pos = 10
  if ((flags & 0x40) !== 0) {
    const extSize = useSyncsafe ? syncsafe(tag, pos) : ((tag[pos] << 24) | (tag[pos + 1] << 16) | (tag[pos + 2] << 8) | tag[pos + 3])
    pos += extSize
  }
  const end = Math.min(10 + tagSize, tag.length)
  let usltText: string | undefined
  let syltLines: LyricLine[] | undefined
  while (pos + 10 <= end) {
    const id = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2], tag[pos + 3])
    const size = useSyncsafe
      ? syncsafe(tag, pos + 4)
      : ((tag[pos + 4] << 24) | (tag[pos + 5] << 16) | (tag[pos + 6] << 8) | tag[pos + 7])
    pos += 10
    if (size <= 0 || pos + size > end) break
    const frame = tag.subarray(pos, pos + size)
    if (id === 'USLT') usltText = parseUslt(frame)
    else if (id === 'SYLT') syltLines = parseSylt(frame)
    pos += size
  }
  if (syltLines) return { kind: 'synced', lines: syltLines, source: 'id3', offsetMs: 0, meta: {} }
  if (usltText) {
    const lines = usltText.split(/\r?\n/).map((text) => ({ time: 0, text: text.trimEnd() }))
    return { kind: 'unsynced', lines, source: 'id3', offsetMs: 0, meta: {} }
  }
  return undefined
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).toLocaleLowerCase()
}

interface LyricsResult {
  data?: LyricsData
  sourceName?: string
}

const lyricsCache = new Map<string, LyricsResult>()

export async function loadLyricsFor(
  assetId: string,
  getRecord: (id: string) => Promise<{ blob: Blob; name: string } | undefined>,
  findLrcText: () => Promise<{ name: string; text: string } | undefined>,
  cacheKey = '',
): Promise<LyricsResult> {
  const key = `${assetId}:${cacheKey}`
  const cached = lyricsCache.get(key)
  if (cached) return cached
  const result: LyricsResult = await (async () => {
    const lrc = await findLrcText()
    if (lrc) {
      const data = parseLrc(lrc.text)
      if (data) return { data, sourceName: lrc.name }
    }
    const record = await getRecord(assetId)
    if (record) {
      const data = await extractId3Lyrics(record.blob)
      if (data) return { data, sourceName: '内嵌歌词' }
    }
    return {}
  })()
  if (result.data) lyricsCache.set(key, result)
  return result
}
