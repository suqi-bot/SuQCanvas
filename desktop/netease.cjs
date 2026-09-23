// 网易云：登录态 persist:netease。
// 默认不展示网页（WebContentsView 隐藏），仅「登录」时临时露出；
// 拉歌单/搜索在页内用 Cookie 请求，并带 DOM 兜底。
const { WebContentsView, shell } = require('electron')

const NETEASE_HOME = 'https://music.163.com/'
const NETEASE_MY_MUSIC = 'https://music.163.com/#/my/m/music'
const ALLOWED_HOSTS = new Set(['music.163.com', 'y.music.163.com', 'music.126.net'])

function parseNeteaseTarget(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return { type: 'home' }
  if (/^\d+$/.test(raw)) return { type: 'song', id: raw }
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  const host = url.hostname.toLowerCase()
  if (!ALLOWED_HOSTS.has(host) && !host.endsWith('.music.163.com')) return null
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const id = url.searchParams.get('id') || (hash.match(/[?&]id=(\d+)/) || [])[1] || ''
  const combined = `${url.pathname}${url.search}${hash}`
  if (/\/playlist/i.test(combined)) return id ? { type: 'playlist', id } : { type: 'home' }
  if (/\/album/i.test(combined)) return id ? { type: 'album', id } : { type: 'home' }
  if (/\/song/i.test(combined)) return id ? { type: 'song', id } : { type: 'home' }
  return { type: 'home' }
}

function neteaseUrlFor(ref) {
  if (!ref || ref.type === 'home' || !ref.id) return NETEASE_HOME
  if (ref.type === 'playlist') return `https://music.163.com/#/playlist?id=${encodeURIComponent(ref.id)}`
  if (ref.type === 'album') return `https://music.163.com/#/album?id=${encodeURIComponent(ref.id)}`
  return `https://music.163.com/#/song?id=${encodeURIComponent(ref.id)}`
}

function clampBounds(bounds, maxWidth, maxHeight) {
  if (!bounds || typeof bounds !== 'object') return null
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const width = Math.max(0, Math.min(num(bounds.width), maxWidth))
  const height = Math.max(0, Math.min(num(bounds.height), maxHeight))
  const x = Math.max(0, Math.min(num(bounds.x), Math.max(0, maxWidth - width)))
  const y = Math.max(0, Math.min(num(bounds.y), Math.max(0, maxHeight - height)))
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** 网易云歌曲内容在同源 g_iframe，播放器音频可能在顶层或 iframe。 */
const MEDIA_DOM_HELPERS = `
  const documents = () => {
    const found = [document]
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        if (frame.contentDocument && !found.includes(frame.contentDocument)) found.push(frame.contentDocument)
      } catch { /* 跨域 frame 不可访问 */ }
    }
    return found
  }
  const mediaElements = () => documents().flatMap((doc) => [...doc.querySelectorAll('audio,video')])
  const playerBar = () => {
    for (const doc of documents()) {
      const bar = doc.querySelector('#g_player, .m-playbar')
      if (bar) return bar
    }
    return null
  }
  const playerState = () => {
    const bar = playerBar()
    const button = bar?.querySelector('.btns .pas, .btns .ply')
    const text = String(bar?.querySelector('.m-pbar .time')?.textContent || '')
    const clocks = text.match(/\\d{1,3}:\\d{2}(?::\\d{2})?/g) || []
    const seconds = (clock) => String(clock || '').split(':').reduce((total, part) => total * 60 + Number(part), 0)
    const width = String(bar?.querySelector('.m-pbar .cur')?.style?.width || '')
    const progress = width.endsWith('%') ? Math.min(1, Math.max(0, Number.parseFloat(width) / 100)) : 0
    const songLink = bar?.querySelector('.words .name[href*="song"], .head a[href*="song"]')
    const songId = String(songLink?.getAttribute('href') || '').match(/[?&]id=(\\d+)/)?.[1] || ''
    return {
      playing: Boolean(button?.classList?.contains('pas')),
      time: seconds(clocks[0]),
      duration: seconds(clocks[1]),
      progress: Number.isFinite(progress) ? progress : 0,
      songId,
    }
  }
  const isPlaying = () => mediaElements().some((el) =>
    !el.paused && !el.ended && Boolean(el.currentSrc || el.src || el.readyState > 0)) || playerState().playing
`

const PAUSE_SCRIPT = `(() => {
  ${MEDIA_DOM_HELPERS}
  let paused = false
  for (const el of mediaElements()) {
    if (!el.paused) { try { el.pause(); paused = true } catch {} }
  }
  if (!paused) {
    const button = playerBar()?.querySelector('.btns .pas')
    if (button) { try { button.click(); paused = true } catch {} }
  }
  if (document.documentElement && document.documentElement.pauseMedia) {
    try { document.documentElement.pauseMedia(); paused = true } catch {}
  }
  return paused
})()`

const PLAY_SCRIPT = `(async () => {
  ${MEDIA_DOM_HELPERS}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const tryMedia = async () => {
    for (const el of mediaElements()) {
      if (!el.currentSrc && !el.src) continue
      if (el.paused) {
        try { await el.play() } catch {}
      }
      if (isPlaying()) return true
    }
    return isPlaying()
  }
  for (let i = 0; i < 20; i++) {
    if (await tryMedia()) return true
    // 只点一次底栏继续播放，避免把刚起播的音频再次暂停。
    if (i === 0) {
      const node = document.querySelector('.m-playbar .ply, .g-btmbar .btn-play')
      if (node) { try { node.click() } catch {} }
    }
    await sleep(250)
    if (await tryMedia()) return true
  }
  return false
})()`

/**
 * 构建「校验当前页 song id 后再起播」的脚本。
 * 避免 SPA 未切页时点到首页/列表的第一首。
 */
function buildPlaySongScript(songId) {
  const id = String(songId || '').trim()
  if (!/^\d+$/.test(id)) return null
  return `(async () => {
  ${MEDIA_DOM_HELPERS}
  const expectedId = ${JSON.stringify(id)}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const currentSongId = () => {
    const hay = String(location.hash || '') + String(location.search || '') + String(location.pathname || '')
    if (!/song/i.test(hay)) return ''
    const m = hay.match(/song\\/?[?&]?id=(\\d+)/i) || hay.match(/[?&]id=(\\d+)/)
    return m ? m[1] : ''
  }
  const songPage = () => {
    // 经典网页的歌曲内容在 g_iframe；它可能还停留在上一首，不能误点。
    const frame = document.querySelector('#g_iframe')
    if (frame) {
      try {
        const doc = frame.contentDocument
        const url = String(doc?.location?.href || '')
        const match = url.match(/\\/song\\/?[?&]id=(\\d+)/i)
        if (doc && match?.[1] === expectedId) return doc
      } catch {}
      return null
    }
    return currentSongId() === expectedId ? document : null
  }
  const playButton = (doc) => {
    const selectors = [
      '#content-operation [data-res-action="play"]',
      '[data-res-action="play"][data-res-id="' + expectedId + '"]',
      '.m-song [data-res-action="play"]',
      'a[data-res-action="play"]',
    ]
    for (const selector of selectors) {
      const node = doc.querySelector(selector)
      if (node) return node
    }
    return null
  }
  const result = { ok: false, stage: 'wait-route', expectedId, actualId: '', hash: location.hash, buttonFound: false, mediaFound: false }
  for (let i = 0; i < 30; i++) {
    result.actualId = currentSongId()
    result.hash = location.hash
    if (result.actualId === expectedId) { result.stage = 'routed'; break }
    // 若 SPA 未响应 loadURL，强制改 hash
    if (i === 8) {
      try { location.hash = '/song?id=' + expectedId } catch {}
    }
    await sleep(200)
  }
  if (result.stage !== 'routed') return result
  let clicked = false
  for (let i = 0; i < 40; i++) {
    if (currentSongId() !== expectedId) break
    const doc = songPage()
    const button = doc && playButton(doc)
    if (button) result.buttonFound = true
    result.mediaFound = mediaElements().length > 0
    if (clicked && isPlaying()) {
      result.ok = true
      result.stage = 'playing'
      return result
    }
    // 每次点歌只触发一次。再次点击可能重置进度，或把播放切回暂停。
    if (button && !clicked) {
      try { button.click(); clicked = true } catch {}
    }
    await sleep(250)
    if (clicked && isPlaying() && currentSongId() === expectedId) {
      result.ok = true
      result.stage = 'playing'
      return result
    }
  }
  result.actualId = currentSongId()
  result.hash = location.hash
  result.stage = 'timeout'
  return result
})()`
}

/** 读取页内播放状态（进度 / 暂停 / 当前 song id） */
const GET_PLAYBACK_STATE_SCRIPT = `(() => {
  ${MEDIA_DOM_HELPERS}
  const hay = String(location.hash || '') + String(location.search || '')
  let songId = ''
  if (/song/i.test(hay)) {
    const m = hay.match(/song\\/?[?&]?id=(\\d+)/i) || hay.match(/[?&]id=(\\d+)/)
    songId = m ? m[1] : ''
  }
  let playing = false
  let time = 0
  let duration = 0
  for (const el of mediaElements()) {
    if (!el.currentSrc && !el.src) continue
    if (!el.paused && !el.ended) playing = true
    const t = Number(el.currentTime) || 0
    const d = Number(el.duration)
    if (t > time) time = t
    if (Number.isFinite(d) && d > duration) duration = d
  }
  const player = playerState()
  if (!playing) playing = player.playing
  if (!time) time = player.time
  if (!duration) duration = player.duration
  if (player.songId) songId = player.songId
  const progress = duration > 0 ? Math.min(1, time / duration) : player.progress
  return { songId, playing, time, duration, progress, hash: String(location.hash || '') }
})()`

/** 名称是否像「我喜欢的音乐」 */
function isLikedPlaylistName(name) {
  const n = String(name || '').replace(/\s+/g, '')
  if (!n) return false
  if (n === '我喜欢的音乐' || n === '我喜欢的') return true
  // 允许「我喜欢的音乐(1)」等变体；避免误伤普通歌单
  return n.startsWith('我喜欢的音乐') || n === '我喜欢'
}

function pickLikedPlaylist(playlists) {
  if (!Array.isArray(playlists)) return null
  const list = playlists.filter(Boolean)
  return (
    list.find((p) => isLikedPlaylistName(p.name)) ||
    list.find((p) => p.specialType === 1) ||
    null
  )
}

function artistsOf(song) {
  const list = song?.ar || song?.artists || []
  return list.map((a) => a && a.name).filter(Boolean).join('/')
}

function coverOf(song) {
  return song?.al?.picUrl || song?.album?.picUrl || ''
}

function mapTracksToSongs(tracks) {
  if (!Array.isArray(tracks)) return []
  return tracks
    .filter((t) => t && t.id && t.name)
    .map((t) => ({
      id: String(t.id),
      name: String(t.name),
      artist: artistsOf(t),
      coverUrl: coverOf(t),
    }))
}

/** 归一化用户歌单列表项 */
function mapPlaylistSummaries(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const p of raw) {
    if (!p) continue
    const id = String(p.id || p.playlistId || '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: String(p.name || p.playlistName || `歌单 ${id}`),
      trackCount: Number(p.trackCount) || 0,
      coverUrl: String(p.coverUrl || p.coverImgUrl || ''),
      specialType: Number(p.specialType) || 0,
    })
  }
  return out
}

/** 页内：拉取当前账号全部歌单（多接口 + 「我的音乐」DOM 轮询兜底） */
const FETCH_PLAYLISTS_SCRIPT = `(async () => {
  const fail = (stage, message) => ({ ok: false, stage, message })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const get = async (url, headers) => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: Object.assign({ Accept: 'application/json', Referer: 'https://music.163.com/' }, headers || {}),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const text = await res.text()
    try { return JSON.parse(text) } catch { throw new Error('非 JSON: ' + text.slice(0, 80)) }
  }
  const mapPl = (p) => ({
    id: String(p.id),
    name: String(p.name || ''),
    trackCount: Number(p.trackCount) || 0,
    coverUrl: String(p.coverImgUrl || p.picUrl || ''),
    specialType: Number(p.specialType) || 0,
  })
  const extractList = (data) => {
    if (!data) return []
    const candidates = [
      data.playlist,
      data.data && data.data.playlist,
      data.result && data.result.playlist,
      data.playlists,
      data.body && data.body.playlist,
    ]
    for (const c of candidates) {
      if (Array.isArray(c) && c.length) return c
    }
    return Array.isArray(data.playlist) ? data.playlist : []
  }
  const scrape = () => {
    const byId = new Map()
    const add = (id, name, cover) => {
      if (!id || !name) return
      if (byId.has(id)) return
      byId.set(id, {
        id,
        name: String(name).replace(/\\s+/g, ' ').trim().slice(0, 80),
        trackCount: 0,
        coverUrl: cover || '',
        specialType: /我喜欢/.test(name) ? 1 : 0,
      })
    }
    const anchors = document.querySelectorAll('a[href*="playlist"]')
    for (const a of anchors) {
      const href = a.getAttribute('href') || ''
      const m = href.match(/id=(\\d+)/)
      if (!m) continue
      const name = (a.textContent || a.innerText || '').trim()
      if (!name || name.length > 80) continue
      const img = a.querySelector('img')
      add(m[1], name, img ? (img.getAttribute('src') || '') : '')
    }
    // 宽松：任意带 playlist?id 的节点
    if (byId.size === 0) {
      const html = document.documentElement.innerHTML
      const re = /playlist\\?id=(\\d{5,})/g
      let m
      const seen = new Set()
      while ((m = re.exec(html))) {
        if (seen.has(m[1])) continue
        seen.add(m[1])
        add(m[1], '歌单 ' + m[1], '')
      }
    }
    return [...byId.values()]
  }
  try {
    const account = await get('https://music.163.com/api/nuser/account/get')
    const uid = account?.profile?.userId ?? account?.account?.id
    if (!uid) return fail('login', '未登录，请先登录')

    const apiNotes = []
    let fromApi = []
    const uidStr = encodeURIComponent(String(uid))
    const endpoints = [
      'https://music.163.com/api/v1/user/playlist?uid=' + uidStr + '&limit=1000&offset=0',
      'https://music.163.com/api/user/playlist?uid=' + uidStr + '&limit=1000&offset=0',
      'https://music.163.com/api/v1/playlist/my?limit=1000',
    ]
    for (const url of endpoints) {
      try {
        const data = await get(url)
        const arr = extractList(data).map(mapPl).filter((p) => p.id && p.name)
        apiNotes.push(url.split('?')[0].split('/').pop() + '=' + arr.length + '/code' + data.code)
        if (arr.length > fromApi.length) fromApi = arr
        if (fromApi.length) break
      } catch (e) {
        apiNotes.push('err:' + String(e && e.message || e).slice(0, 40))
      }
    }

    let fromDom = []
    let domTries = 0
    if (fromApi.length === 0) {
      // 强制进入「我的音乐」并轮询 DOM（后台页也可能不渲染，多试几轮）
      const target = 'https://music.163.com/#/my/m/music'
      if (!/#\\/my\\/m\\/music/.test(location.hash)) {
        location.hash = '#/my/m/music'
        await sleep(1200)
      }
      for (let i = 0; i < 12; i++) {
        domTries += 1
        fromDom = scrape()
        if (fromDom.length) break
        if (i === 3) {
          // 再试一次完整 hash 跳转
          location.href = target
          await sleep(1500)
        }
        await sleep(500)
      }
    }

    const merged = new Map()
    for (const p of [...fromApi, ...fromDom]) {
      if (!merged.has(p.id)) merged.set(p.id, p)
      else {
        const cur = merged.get(p.id)
        if (!cur.trackCount && p.trackCount) cur.trackCount = p.trackCount
        if (!cur.coverUrl && p.coverUrl) cur.coverUrl = p.coverUrl
        if (p.specialType) cur.specialType = p.specialType
      }
    }
    const playlists = [...merged.values()]
    if (!playlists.length) {
      const anchors = document.querySelectorAll('a[href*="playlist"]').length
      return fail(
        'playlist',
        '未读取到歌单（API: ' + (apiNotes.join(' | ') || '无') +
        '；DOM锚点=' + anchors +
        '；hash=' + location.hash + '）',
      )
    }
    playlists.sort((a, b) => {
      const score = (p) => (p.specialType === 1 ? 0 : /我喜欢/.test(p.name) ? 1 : 2)
      return score(a) - score(b)
    })
    return { ok: true, playlists, debug: { api: fromApi.length, dom: fromDom.length, tries: domTries, notes: apiNotes } }
  } catch (error) {
    return fail('exception', String((error && error.message) || error))
  }
})()`

/** 页内：按歌单 id 拉歌曲（__PLAYLIST_ID__ 由调用方替换） */
const FETCH_PLAYLIST_SONGS_SCRIPT = `(async () => {
  const fail = (stage, message) => ({ ok: false, stage, message })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const get = async (url) => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', Referer: 'https://music.163.com/' },
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const text = await res.text()
    try { return JSON.parse(text) } catch { throw new Error('非 JSON: ' + text.slice(0, 60)) }
  }
  const songFromDetail = (t) => ({
    id: String(t.id),
    name: String(t.name || ''),
    artist: (t.ar || t.artists || []).map((a) => a && a.name).filter(Boolean).join('/'),
    coverUrl: (t.al || t.album || {}).picUrl || '',
  })
  const extractPlaylist = (data) => data && (data.playlist || (data.data && data.data.playlist) || {})
  const scrapeSongs = () => {
    const byId = new Map()
    const anchors = document.querySelectorAll('a[href*="/song"], a[href*="song?id="]')
    for (const a of anchors) {
      const href = a.getAttribute('href') || ''
      const m = href.match(/(?:song\\/?id=|song\\/)(\\d+)/)
      if (!m) continue
      const name = (a.textContent || a.innerText || '').replace(/\\s+/g, ' ').trim()
      if (!name || name.length > 80) continue
      if (!byId.has(m[1])) {
        byId.set(m[1], { id: m[1], name, artist: '', coverUrl: '' })
      }
    }
    return [...byId.values()]
  }
  try {
    const playlistId = __PLAYLIST_ID__
    if (!/^\\d+$/.test(String(playlistId))) return fail('args', '无效的歌单 id')

    const detailUrls = [
      'https://music.163.com/api/v6/playlist/detail?id=' + playlistId + '&n=100000&latest=true',
      'https://music.163.com/api/v3/playlist/detail?id=' + playlistId + '&n=100000',
      'https://music.163.com/api/playlist/detail?id=' + playlistId,
    ]
    let playlist = {}
    let lastErr = ''
    for (const url of detailUrls) {
      try {
        const data = await get(url)
        playlist = extractPlaylist(data)
        if (playlist && (playlist.trackIds || playlist.tracks || playlist.name)) break
      } catch (e) {
        lastErr = String((e && e.message) || e)
      }
    }

    const trackIds = ((playlist && playlist.trackIds) || [])
      .map((t) => String(typeof t === 'object' && t ? t.id : t))
      .filter((id) => /^\\d+$/.test(id))
    const embedded = playlist && Array.isArray(playlist.tracks) ? playlist.tracks : []
    let songs = []

    if (embedded.length > 0 && embedded.some((t) => t && t.name)) {
      songs = embedded.filter((t) => t && t.id && t.name).map(songFromDetail)
    }

    if (songs.length < trackIds.length && trackIds.length) {
      const byId = new Map(songs.map((s) => [s.id, s]))
      const missing = trackIds.filter((id) => !byId.has(id))
      const BATCH = 50
      for (let i = 0; i < missing.length; i += BATCH) {
        const ids = missing.slice(i, i + BATCH)
        try {
          const data = await get('https://music.163.com/api/song/detail?ids=' + encodeURIComponent(JSON.stringify(ids)))
          for (const s of data.songs || []) {
            if (s && s.id) byId.set(String(s.id), songFromDetail(s))
          }
        } catch (e) {
          lastErr = String((e && e.message) || e)
        }
      }
      songs = trackIds.map((id) => byId.get(id)).filter(Boolean)
    }

    if (!songs.length) {
      // 打开歌单页扫 DOM
      const prevHash = location.hash
      location.hash = '#/playlist?id=' + playlistId
      await sleep(1800)
      for (let i = 0; i < 6 && songs.length === 0; i++) {
        songs = scrapeSongs()
        if (!songs.length) await sleep(500)
      }
      if (prevHash && prevHash !== location.hash) {
        // 不强制回跳，避免打断
      }
    }

    if (!songs.length) {
      return fail(
        'tracks',
        '未读到歌曲（detail名=' + String(playlist.name || '-') +
        ' trackIds=' + trackIds.length +
        ' embedded=' + embedded.length +
        (lastErr ? ' err=' + lastErr : '') + '）',
      )
    }
    return {
      ok: true,
      playlistId,
      playlistName: String(playlist.name || ''),
      songs,
    }
  } catch (error) {
    return fail('exception', String((error && error.message) || error))
  }
})()`

function buildPlaylistSongsScript(playlistId) {
  const id = String(playlistId || '').trim()
  if (!/^\d+$/.test(id)) return null
  // JSON.stringify 保证安全嵌入，避免脚本语法错误
  return FETCH_PLAYLIST_SONGS_SCRIPT.replace('__PLAYLIST_ID__', JSON.stringify(id))
}

/**
 * 页内拉取：API 列表匹配 + 打开「我的音乐」后 DOM 兜底。
 * 返回 { ok, playlistId, playlistName, songs } 或 { ok:false, stage, message }
 */
const FETCH_LIKED_SCRIPT = `(async () => {
  const fail = (stage, message) => ({ ok: false, stage, message })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const get = async (url) => {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
  }
  const likedName = (name) => {
    const n = String(name || '').replace(/\\s+/g, '')
    if (!n) return false
    return n === '我喜欢的音乐' || n === '我喜欢的' || n === '我喜欢' || n.startsWith('我喜欢的音乐')
  }
  const songFromDetail = (t) => ({
    id: String(t.id),
    name: String(t.name),
    artist: (t.ar || t.artists || []).map((a) => a.name).filter(Boolean).join('/'),
    coverUrl: (t.al || t.album || {}).picUrl || '',
  })
  const loadSongs = async (playlistId) => {
    const detail = await get(
      'https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(playlistId) + '&n=100000&latest=true',
    )
    const playlist = detail.playlist || {}
    const trackIds = (playlist.trackIds || []).map((t) => String(t.id)).filter(Boolean)
    const embedded = Array.isArray(playlist.tracks) ? playlist.tracks : []
    if (embedded.length > 0 && embedded.every((t) => t && t.name)) {
      return embedded.map(songFromDetail)
    }
    if (!trackIds.length) return []
    const byId = new Map()
    const BATCH = 80
    for (let i = 0; i < trackIds.length; i += BATCH) {
      const ids = trackIds.slice(i, i + BATCH)
      const data = await get('https://music.163.com/api/song/detail?ids=' + encodeURIComponent(JSON.stringify(ids)))
      for (const s of data.songs || []) byId.set(String(s.id), songFromDetail(s))
    }
    return trackIds.map((id) => byId.get(id)).filter(Boolean)
  }
  try {
    const account = await get('https://music.163.com/api/nuser/account/get')
    const uid = account?.profile?.userId ?? account?.account?.id
    if (!uid) return fail('login', '未登录或无法读取账号，请先登录')
    const lists = await get(
      'https://music.163.com/api/v1/user/playlist?uid=' + encodeURIComponent(String(uid)) + '&limit=1000',
    )
    const playlists = (lists.playlist || []).map((p) => ({
      id: String(p.id),
      name: String(p.name || ''),
      specialType: p.specialType,
    }))
    const liked =
      playlists.find((p) => likedName(p.name)) ||
      playlists.find((p) => p.specialType === 1) ||
      null
    if (!liked) return fail('playlist', '未找到「我喜欢的音乐」，请改用全部歌单列表')
    const songs = await loadSongs(liked.id)
    if (!songs.length) return fail('tracks', '歌单里没有可读取的歌曲')
    return { ok: true, playlistId: liked.id, playlistName: liked.name || '我喜欢的音乐', songs }
  } catch (error) {
    return fail('exception', String((error && error.message) || error))
  }
})()`

const SEARCH_SCRIPT = `(async () => {
  const q = String(SEARCH_QUERY || '').trim()
  if (!q) return { ok: false, message: '请输入关键词' }
  try {
    const url = 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(q) + '&type=1&limit=30&offset=0'
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    const result = data.result || {}
    const songs = (result.songs || []).map((s) => ({
      id: String(s.id),
      name: String(s.name || s.id),
      artist: (s.artists || s.ar || []).map((a) => a.name).filter(Boolean).join('/'),
      coverUrl: ((s.album || s.al || {}).picUrl) || '',
    }))
    if (!songs.length) return { ok: true, songs: [] }
    return { ok: true, songs }
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error) }
  }
})()`

function createNeteasePanel({ getWindow }) {
  let view = null
  let attached = false
  let bounds = { x: 0, y: 0, width: 0, height: 0 }
  let browserVisible = false
  let currentTarget = { type: 'home' }
  let lastStartedSongId = ''
  /** 离屏停放尺寸：0×0 会导致 Chromium 不跑媒体/合成 */
  const PARKED = { x: -16000, y: -16000, width: 480, height: 360 }

  function ensureView() {
    if (view) return view
    const win = getWindow()
    if (!win || win.isDestroyed()) throw new Error('主窗口不可用')
    view = new WebContentsView({
      webPreferences: {
        partition: 'persist:netease',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
      },
    })
    try {
      view.webContents.setBackgroundThrottling(false)
    } catch { /* older electron */ }
    view.setBackgroundColor('#f8fafc')
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' }
      let host = ''
      try { host = new URL(url).hostname.toLowerCase() } catch { return { action: 'deny' } }
      if (ALLOWED_HOSTS.has(host) || host.endsWith('.music.163.com') || host.endsWith('.music.126.net')) {
        void view.webContents.loadURL(url).catch(() => undefined)
        return { action: 'deny' }
      }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event, url) => {
      try {
        const host = new URL(url).hostname.toLowerCase()
        const ok = ALLOWED_HOSTS.has(host) || host.endsWith('.music.163.com') || host.endsWith('.music.126.net') || url.startsWith('about:')
        if (!ok) event.preventDefault()
      } catch {
        event.preventDefault()
      }
    })
    return view
  }

  function applyBounds() {
    if (!view || !attached) return
    if (browserVisible) {
      view.setBounds(bounds)
    } else {
      // 离屏停放（非 0×0）：0×0 可能导致媒体/合成不跑，点播无声、读不到进度
      view.setBounds(PARKED)
    }
  }

  function attach() {
    const win = getWindow()
    if (!win || win.isDestroyed()) throw new Error('主窗口不可用')
    const v = ensureView()
    if (!attached) {
      win.contentView.addChildView(v)
      attached = true
    }
    applyBounds()
  }

  function detach() {
    if (!view || !attached) return
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      try { win.contentView.removeChildView(view) } catch { /* already removed */ }
    }
    attached = false
    browserVisible = false
  }

  /** 串行化 loadURL，避免 open/刷新/搜索并发互相 ERR_ABORTED */
  let loadChain = Promise.resolve()
  function serializedLoad(run) {
    const next = loadChain.then(run, run)
    loadChain = next.then(() => undefined, () => undefined)
    return next
  }

  function isAbortError(error) {
    const msg = String((error && error.message) || error)
    return /ERR_ABORTED|aborted/i.test(msg)
  }

  function waitUntilIdle(v, timeoutMs = 20000) {
    return new Promise((resolve) => {
      const started = Date.now()
      const tick = () => {
        if (!v.webContents || v.webContents.isDestroyed()) {
          resolve()
          return
        }
        if (!v.webContents.isLoading() || Date.now() - started >= timeoutMs) {
          resolve()
          return
        }
        setTimeout(tick, 80)
      }
      tick()
    })
  }

  async function loadPage(url) {
    const v = ensureView()
    return serializedLoad(async () => {
      const current = v.webContents.getURL() || ''
      // 含 hash：同页切歌也要 loadURL，否则会停在旧曲
      const needLoad = current !== url || v.webContents.isLoading()
      if (needLoad) {
        try {
          await v.webContents.loadURL(url)
        } catch (error) {
          if (!isAbortError(error)) throw error
        }
      }
      await waitUntilIdle(v)
      const after = v.webContents.getURL() || ''
      if (after !== url && /^https:/i.test(after)) {
        // SPA 可能只改了 hash：再强制一次
        try {
          if (after !== url) await v.webContents.loadURL(url)
        } catch (error) {
          if (!isAbortError(error)) throw error
        }
        await waitUntilIdle(v)
      }
      if (!/^https:/i.test(v.webContents.getURL() || '')) {
        try {
          await v.webContents.loadURL(url)
        } catch (error) {
          if (!isAbortError(error)) throw error
        }
        await waitUntilIdle(v)
      }
      return { ok: true, url: v.webContents.getURL() || url }
    })
  }

  async function ensureOnNetease() {
    const v = ensureView()
    const url = v.webContents.getURL() || ''
    if (!/^https:\/\/(music\.163\.com|y\.music\.163\.com)\//i.test(url)) {
      await loadPage(NETEASE_HOME)
    } else if (v.webContents.isLoading()) {
      await waitUntilIdle(v)
    }
  }

  async function loadRef(ref, { autoplay = true } = {}) {
    currentTarget = ref || { type: 'home' }
    if (currentTarget.type === 'song') {
      lastStartedSongId = ''
      try { await ensureView().webContents.executeJavaScript(PAUSE_SCRIPT, true) } catch {}
    }
    const url = neteaseUrlFor(currentTarget)
    await loadPage(url)
    if (autoplay) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 400))
        const v = ensureView()
        const script = currentTarget.type === 'song' ? buildPlaySongScript(currentTarget.id) : PLAY_SCRIPT
        if (script) {
          const result = await v.webContents.executeJavaScript(script, true)
          if (currentTarget.type === 'song' && result?.ok) lastStartedSongId = currentTarget.id
        }
      } catch { /* ignore */ }
    }
  }

  return {
    parse: parseNeteaseTarget,
    isOpen: () => attached,
    isBrowserVisible: () => browserVisible,
    currentRef: () => ({ ...currentTarget }),
    /**
     * 打开逻辑面板。showBrowser=false 时网页不可见（默认），
     * 仅登录 showBrowser=true + bounds 时露出。
     */
    async open({ input, bounds: nextBounds, showBrowser = false } = {}) {
      if (nextBounds) {
        const win = getWindow()
        const w = win && !win.isDestroyed() ? win.getContentSize()[0] : 0
        const h = win && !win.isDestroyed() ? win.getContentSize()[1] : 0
        const clamped = clampBounds(nextBounds, w || 10000, h || 10000)
        if (clamped) bounds = clamped
      }
      attach()
      browserVisible = Boolean(showBrowser && bounds.width > 20 && bounds.height > 20)
      applyBounds()
      const ref = typeof input === 'string' || input == null
        ? parseNeteaseTarget(typeof input === 'string' ? input : '')
        : input
      const resolved = ref || { type: 'home' }
      // 只在明确指定歌曲时起播，登录页不碰播放器。
      const autoplay = resolved.type === 'song'
      await loadRef(resolved, { autoplay })
      return { ok: true, url: neteaseUrlFor(currentTarget), browserVisible }
    },
    async navigate(input, opts = {}) {
      if (!attached) await this.open({ input, ...opts })
      else {
        const ref = parseNeteaseTarget(typeof input === 'string' ? input : '')
        await loadRef(ref || { type: 'home' }, { autoplay: opts.autoplay !== false })
      }
      return { ok: true, url: neteaseUrlFor(currentTarget) }
    },
    /** 仅露出网页（登录） */
    async showBrowser(nextBounds) {
      if (nextBounds) {
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          const [w, h] = win.getContentSize()
          const clamped = clampBounds(nextBounds, w, h)
          if (clamped) bounds = clamped
        } else {
          bounds = nextBounds
        }
      }
      attach()
      browserVisible = true
      applyBounds()
      await ensureOnNetease()
      return { ok: true }
    },
    /** 藏起网页，只留列表 UI */
    hideBrowser() {
      browserVisible = false
      applyBounds()
      return { ok: true }
    },
    layout(nextBounds) {
      if (!nextBounds) return false
      const win = getWindow()
      if (!win || win.isDestroyed()) return false
      const [w, h] = win.getContentSize()
      const clamped = clampBounds(nextBounds, w, h)
      if (!clamped) return false
      bounds = clamped
      applyBounds()
      return true
    },
    async pause() {
      if (!view || view.webContents.isDestroyed()) return false
      try {
        return Boolean(await view.webContents.executeJavaScript(PAUSE_SCRIPT, true))
      } catch {
        return false
      }
    },
    async tryPlay() {
      if (!view || view.webContents.isDestroyed()) return false
      try {
        return Boolean(await view.webContents.executeJavaScript(PLAY_SCRIPT, true))
      } catch {
        return false
      }
    },
    /** 读取播放状态：进度 / 是否在播 / 当前 song id */
    async getPlaybackState() {
      if (!view || view.webContents.isDestroyed()) {
        return { songId: '', playing: false, time: 0, duration: 0, progress: 0, hash: '' }
      }
      try {
        const s = await view.webContents.executeJavaScript(GET_PLAYBACK_STATE_SCRIPT, true)
        if (!s || typeof s !== 'object') {
          return { songId: '', playing: false, time: 0, duration: 0, progress: 0, hash: '' }
        }
        return {
          songId: String(s.songId || ''),
          playing: Boolean(s.playing || view.webContents.isCurrentlyAudible?.()),
          time: Number(s.time) || 0,
          duration: Number(s.duration) || 0,
          progress: Number(s.progress) || 0,
          hash: String(s.hash || ''),
        }
      } catch {
        return { songId: '', playing: false, time: 0, duration: 0, progress: 0, hash: '' }
      }
    },
    /** 播放/暂停切换 */
    async togglePlayback() {
      const state = await this.getPlaybackState()
      if (state.playing) {
        const paused = await this.pause()
        return { ok: true, playing: false, paused }
      }
      if (currentTarget.type === 'song' && lastStartedSongId !== currentTarget.id) {
        const result = await this.playSong(currentTarget.id)
        return { ok: result.ok, playing: result.ok, message: result.message }
      }
      const ok = await this.tryPlay()
      const after = await this.getPlaybackState()
      return { ok: ok || after.playing, playing: after.playing }
    },
    /** 点歌后强制起播（与 tryPlay 同路径，语义上给 IPC 用） */
    async play() {
      return this.tryPlay()
    },
    /**
     * 画布点播：串行导航到目标 song + 校验 id + 起播。
     * 返回 { ok, stage, expectedId, actualId, hash, message? }
     */
    async playSong(songId) {
      const id = String(songId || '').trim()
      if (!/^\d+$/.test(id)) {
        return { ok: false, stage: 'args', message: '无效的歌曲 id' }
      }
      try {
        attach()
        lastStartedSongId = ''
        const script = buildPlaySongScript(id)
        if (!script) return { ok: false, stage: 'args', message: '无效的歌曲 id' }
        // 旧曲仍在播放时，路由切换不能证明音频已经换成目标曲。
        await this.pause()
        const url = neteaseUrlFor({ type: 'song', id })
        currentTarget = { type: 'song', id }
        await loadPage(url)
        const v = ensureView()
        // load 后可能仍是 SPA 首页，脚本内会继续等路由
        const result = await v.webContents.executeJavaScript(script, true)
        if (!result || typeof result !== 'object') {
          return { ok: false, stage: 'empty', message: '起播脚本无返回' }
        }
        const state = result.ok ? null : await this.getPlaybackState()
        if (result.ok || (result.buttonFound && state?.playing && state.songId === id)) {
          lastStartedSongId = id
          return { ...result, ok: true, stage: 'playing', expectedId: id }
        }
        return {
          ...result,
          ok: false,
          message:
            result.stage === 'timeout'
              ? `未在超时内起播（期望 id=${id}，当前=${result.actualId || '-'}，播放按钮=${result.buttonFound ? '已找到' : '未找到'}，音频=${result.mediaFound ? '已找到' : '未找到'}）`
              : `起播失败 stage=${result.stage}`,
        }
      } catch (error) {
        return {
          ok: false,
          stage: 'execute',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async fetchLiked() {
      try {
        attach()
        await ensureOnNetease()
        const v = ensureView()
        const result = await v.webContents.executeJavaScript(FETCH_LIKED_SCRIPT, true)
        if (!result || typeof result !== 'object') {
          return { ok: false, stage: 'empty', message: '页面未返回数据' }
        }
        if (result.ok) {
          return {
            ok: true,
            playlistId: String(result.playlistId || ''),
            playlistName: String(result.playlistName || '我喜欢的音乐'),
            songs: Array.isArray(result.songs) ? result.songs : [],
          }
        }
        return {
          ok: false,
          stage: String(result.stage || 'unknown'),
          message: String(result.message || '拉取失败'),
        }
      } catch (error) {
        return {
          ok: false,
          stage: 'execute',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
    /** 全部用户歌单 */
    async fetchPlaylists() {
      try {
        attach()
        await ensureOnNetease()
        const v = ensureView()
        const result = await v.webContents.executeJavaScript(FETCH_PLAYLISTS_SCRIPT, true)
        if (!result || typeof result !== 'object') {
          return { ok: false, stage: 'empty', message: '页面未返回数据' }
        }
        if (result.ok) {
          return { ok: true, playlists: mapPlaylistSummaries(result.playlists) }
        }
        return {
          ok: false,
          stage: String(result.stage || 'unknown'),
          message: String(result.message || '拉取歌单失败'),
        }
      } catch (error) {
        return {
          ok: false,
          stage: 'execute',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
    /** 指定歌单的歌曲 */
    async fetchPlaylistSongs(playlistId) {
      const id = String(playlistId || '').trim()
      if (!/^\d+$/.test(id)) {
        return { ok: false, stage: 'args', message: '无效的歌单 id' }
      }
      try {
        attach()
        await ensureOnNetease()
        const v = ensureView()
        const body = buildPlaylistSongsScript(id)
        if (!body) {
          return { ok: false, stage: 'args', message: '无效的歌单 id' }
        }
        const result = await v.webContents.executeJavaScript(body, true)
        if (!result || typeof result !== 'object') {
          return { ok: false, stage: 'empty', message: '页面未返回数据' }
        }
        if (result.ok) {
          return {
            ok: true,
            playlistId: String(result.playlistId || id),
            playlistName: String(result.playlistName || ''),
            songs: Array.isArray(result.songs) ? result.songs : [],
          }
        }
        return {
          ok: false,
          stage: String(result.stage || 'unknown'),
          message: String(result.message || '拉取歌曲失败'),
        }
      } catch (error) {
        return {
          ok: false,
          stage: 'execute',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async search(query) {
      const q = String(query || '').trim()
      if (!q) return { ok: false, message: '请输入搜索关键词' }
      try {
        attach()
        await ensureOnNetease()
        const v = ensureView()
        const result = await v.webContents.executeJavaScript(
          `(async () => {
            const q = ${JSON.stringify(q)}
            try {
              const url = 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(q) + '&type=1&limit=30&offset=0'
              const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
              if (!res.ok) throw new Error('HTTP ' + res.status)
              const data = await res.json()
              const body = data.result || {}
              const songs = (body.songs || []).map((s) => ({
                id: String(s.id),
                name: String(s.name || s.id),
                artist: (s.artists || s.ar || []).map((a) => a.name).filter(Boolean).join('/'),
                coverUrl: ((s.album || s.al || {}).picUrl) || '',
              }))
              return { ok: true, songs }
            } catch (error) {
              return { ok: false, message: String((error && error.message) || error) }
            }
          })()`,
          true,
        )
        if (!result || result.ok !== true) {
          return { ok: false, message: (result && result.message) || '搜索失败' }
        }
        return { ok: true, songs: Array.isArray(result.songs) ? result.songs : [] }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
    async isLoggedIn() {
      try {
        attach()
        await ensureOnNetease()
        const v = ensureView()
        const result = await v.webContents.executeJavaScript(
          `(async () => {
            try {
              const res = await fetch('https://music.163.com/api/nuser/account/get', {
                credentials: 'include',
                headers: { Accept: 'application/json' },
              })
              const data = await res.json()
              const uid = data?.profile?.userId ?? data?.account?.id
              return { ok: Boolean(uid), uid: uid ? String(uid) : '' }
            } catch (e) {
              return { ok: false, uid: '' }
            }
          })()`,
          true,
        )
        return Boolean(result && result.ok)
      } catch {
        return false
      }
    },
    close() {
      detach()
    },
    dispose() {
      detach()
      if (view && !view.webContents.isDestroyed()) view.webContents.close()
      view = null
      currentTarget = { type: 'home' }
      browserVisible = false
    },
  }
}

module.exports = {
  NETEASE_HOME,
  NETEASE_MY_MUSIC,
  ALLOWED_HOSTS,
  parseNeteaseTarget,
  neteaseUrlFor,
  clampBounds,
  PAUSE_SCRIPT,
  PLAY_SCRIPT,
  buildPlaySongScript,
  GET_PLAYBACK_STATE_SCRIPT,
  FETCH_LIKED_SCRIPT,
  FETCH_PLAYLISTS_SCRIPT,
  FETCH_PLAYLIST_SONGS_SCRIPT,
  buildPlaylistSongsScript,
  SEARCH_SCRIPT,
  isLikedPlaylistName,
  pickLikedPlaylist,
  mapTracksToSongs,
  mapPlaylistSummaries,
  createNeteasePanel,
}
