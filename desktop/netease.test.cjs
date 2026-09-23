const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const {
  parseNeteaseTarget,
  neteaseUrlFor,
  clampBounds,
  NETEASE_HOME,
  createNeteasePanel,
  pickLikedPlaylist,
  mapTracksToSongs,
  isLikedPlaylistName,
  mapPlaylistSummaries,
  buildPlaylistSongsScript,
  buildPlaySongScript,
  buildSeekScript,
  GET_PLAYBACK_STATE_SCRIPT,
} = require('./netease.cjs')

test('parse accepts bare song id', () => {
  assert.deepEqual(parseNeteaseTarget('26168287'), { type: 'song', id: '26168287' })
})

test('parse accepts song hash and query urls', () => {
  assert.deepEqual(parseNeteaseTarget('https://music.163.com/#/song?id=123'), { type: 'song', id: '123' })
  assert.deepEqual(parseNeteaseTarget('https://music.163.com/song?id=456'), { type: 'song', id: '456' })
  assert.deepEqual(parseNeteaseTarget('https://y.music.163.com/m/song?id=789'), { type: 'song', id: '789' })
})

test('parse accepts playlist and album', () => {
  assert.deepEqual(parseNeteaseTarget('https://music.163.com/#/playlist?id=99'), { type: 'playlist', id: '99' })
  assert.deepEqual(parseNeteaseTarget('https://music.163.com/#/album?id=88'), { type: 'album', id: '88' })
})

test('parse rejects foreign and invalid urls', () => {
  assert.equal(parseNeteaseTarget('https://example.com/song?id=1'), null)
  assert.equal(parseNeteaseTarget('javascript:alert(1)'), null)
  assert.deepEqual(parseNeteaseTarget(''), { type: 'home' })
})

test('neteaseUrlFor builds stable hash routes', () => {
  assert.equal(neteaseUrlFor({ type: 'home' }), NETEASE_HOME)
  assert.equal(neteaseUrlFor({ type: 'song', id: '1' }), 'https://music.163.com/#/song?id=1')
  assert.equal(neteaseUrlFor({ type: 'playlist', id: '2' }), 'https://music.163.com/#/playlist?id=2')
  assert.equal(neteaseUrlFor({ type: 'album', id: '3' }), 'https://music.163.com/#/album?id=3')
})

test('clampBounds keeps panel inside the window', () => {
  assert.deepEqual(clampBounds({ x: -10, y: -5, width: 500, height: 800 }, 1200, 700), {
    x: 0, y: 0, width: 500, height: 700,
  })
  assert.deepEqual(clampBounds({ x: 1100, y: 10, width: 400, height: 200 }, 1200, 700), {
    x: 800, y: 10, width: 400, height: 200,
  })
  assert.equal(clampBounds(null, 100, 100), null)
})

test('panel open without window fails; pause/fetch degrade safely', async () => {
  const panel = createNeteasePanel({ getWindow: () => null })
  assert.equal(panel.isOpen(), false)
  assert.equal(await panel.pause(), false)
  await assert.rejects(() => panel.open({}), /主窗口不可用/)
  const liked = await panel.fetchLiked()
  assert.equal(liked.ok, false)
  assert.match(String(liked.message), /主窗口不可用/)
})

test('pickLikedPlaylist prefers name special then specialType', () => {
  const lists = [
    { id: '1', name: '跑步', specialType: 0 },
    { id: '2', name: '我喜欢的音乐', specialType: 0 },
  ]
  assert.equal(pickLikedPlaylist(lists).id, '2')
  assert.equal(pickLikedPlaylist([{ id: '9', name: 'x', specialType: 1 }]).id, '9')
  assert.equal(pickLikedPlaylist([]), null)
})

test('isLikedPlaylistName accepts common variants', () => {
  assert.equal(isLikedPlaylistName('我喜欢的音乐'), true)
  assert.equal(isLikedPlaylistName(' 我喜欢的音乐 '), true)
  assert.equal(isLikedPlaylistName('我喜欢的音乐(1)'), true)
  assert.equal(isLikedPlaylistName('我的歌单'), false)
})

test('mapTracksToSongs keeps order and joins artists', () => {
  const songs = mapTracksToSongs([
    { id: 11, name: 'A', ar: [{ name: '甲' }, { name: '乙' }], al: { picUrl: 'https://x/1.jpg' } },
    { id: 12, name: 'B', artists: [{ name: '丙' }] },
    { id: null, name: 'skip' },
  ])
  assert.deepEqual(songs, [
    { id: '11', name: 'A', artist: '甲/乙', coverUrl: 'https://x/1.jpg' },
    { id: '12', name: 'B', artist: '丙', coverUrl: '' },
  ])
})

test('mapPlaylistSummaries normalizes and dedupes', () => {
  const list = mapPlaylistSummaries([
    { id: 1, name: '我喜欢的音乐', trackCount: 10, coverImgUrl: 'https://x/c.jpg', specialType: 1 },
    { id: '1', name: '我喜欢的音乐' },
    { playlistId: '2', playlistName: '跑步' },
    null,
    { id: '', name: 'bad' },
  ])
  assert.deepEqual(list, [
    {
      id: '1',
      name: '我喜欢的音乐',
      trackCount: 10,
      coverUrl: 'https://x/c.jpg',
      specialType: 1,
    },
    { id: '2', name: '跑步', trackCount: 0, coverUrl: '', specialType: 0 },
  ])
})

test('fetchPlaylistSongs rejects invalid id without window', async () => {
  const panel = createNeteasePanel({ getWindow: () => null })
  assert.deepEqual(await panel.fetchPlaylistSongs('abc'), {
    ok: false,
    stage: 'args',
    message: '无效的歌单 id',
  })
})

test('buildPlaylistSongsScript injects id safely', () => {
  assert.equal(buildPlaylistSongsScript('nope'), null)
  const script = buildPlaylistSongsScript('123456')
  assert.ok(script && !script.includes('__PLAYLIST_ID__'))
  assert.ok(script.includes('const playlistId = "123456"'))
  assert.equal(buildPlaylistSongsScript('1;alert(1)'), null)
})

test('buildPlaySongScript only accepts numeric ids and embeds expected id', () => {
  assert.equal(buildPlaySongScript(''), null)
  assert.equal(buildPlaySongScript('abc'), null)
  const script = buildPlaySongScript('26168287')
  assert.ok(script)
  assert.ok(script.includes('const expectedId = "26168287"'))
  // 必须等到 song 路由再点播放，避免点到首页第一首
  assert.ok(script.includes('currentSongId() === expectedId'))
  assert.ok(script.includes("stage = 'routed'") || script.includes("result.stage = 'routed'"))
})

test('song playback clicks the matching iframe play button before accepting audio', async () => {
  const id = '3339193481'
  let clicks = 0
  let directPlays = 0
  const media = {
    src: 'https://example.test/previous.mp3', currentSrc: 'https://example.test/previous.mp3',
    paused: true, ended: false, readyState: 4,
    play: async () => { directPlays += 1; media.paused = false },
  }
  const button = { click: () => { clicks += 1; media.paused = false } }
  const songDocument = {
    location: { href: `https://music.163.com/song?id=${id}` },
    querySelector: (selector) => selector === '#content-operation [data-res-action="play"]' ? button : null,
    querySelectorAll: () => [],
  }
  const frame = { contentDocument: songDocument }
  const document = {
    querySelector: (selector) => selector === '#g_iframe' ? frame : null,
    querySelectorAll: (selector) => selector === 'iframe' ? [frame] : selector === 'audio,video' ? [media] : [],
  }
  const result = await vm.runInNewContext(buildPlaySongScript(id), {
    document,
    location: { hash: `#/song?id=${id}`, search: '', pathname: '/' },
    setTimeout: (callback) => callback(),
  })
  assert.equal(result.ok, true)
  assert.equal(clicks, 1)
  assert.equal(directPlays, 0)
})

test('song playback does not click a stale iframe while its route is changing', async () => {
  let clicks = 0
  const songDocument = {
    location: { href: 'https://music.163.com/song?id=111' },
    querySelector: () => ({ click: () => { clicks += 1 } }),
    querySelectorAll: () => [],
  }
  const frame = { contentDocument: songDocument }
  const document = {
    querySelector: (selector) => selector === '#g_iframe' ? frame : null,
    querySelectorAll: (selector) => selector === 'iframe' ? [frame] : [],
  }
  const result = await vm.runInNewContext(buildPlaySongScript('222'), {
    document,
    location: { hash: '#/song?id=222', search: '', pathname: '/' },
    setTimeout: (callback) => callback(),
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'timeout')
  assert.equal(clicks, 0)
})

test('song playback does not restart when audio state is unavailable', async () => {
  let clicks = 0
  const id = '3339193481'
  const songDocument = {
    location: { href: `https://music.163.com/song?id=${id}` },
    querySelector: (selector) => selector === '#content-operation [data-res-action="play"]'
      ? { click: () => { clicks += 1 } } : null,
    querySelectorAll: () => [],
  }
  const frame = { contentDocument: songDocument }
  const document = {
    querySelector: (selector) => selector === '#g_iframe' ? frame : null,
    querySelectorAll: (selector) => selector === 'iframe' ? [frame] : [],
  }
  const result = await vm.runInNewContext(buildPlaySongScript(id), {
    document,
    location: { hash: `#/song?id=${id}`, search: '', pathname: '/' },
    setTimeout: (callback) => callback(),
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'timeout')
  assert.equal(clicks, 1)
})

test('playSong without window returns args/window error', async () => {
  const panel = createNeteasePanel({ getWindow: () => null })
  assert.deepEqual(await panel.playSong('bad'), {
    ok: false,
    stage: 'args',
    message: '无效的歌曲 id',
  })
  const res = await panel.playSong('123')
  assert.equal(res.ok, false)
  assert.match(String(res.message), /主窗口不可用/)
})

test('playback state script reads media progress fields', () => {
  assert.ok(GET_PLAYBACK_STATE_SCRIPT.includes('currentTime'))
  assert.ok(GET_PLAYBACK_STATE_SCRIPT.includes('duration'))
  assert.ok(GET_PLAYBACK_STATE_SCRIPT.includes('playing'))
  assert.ok(GET_PLAYBACK_STATE_SCRIPT.includes('songId'))
})

test('seek uses the active media and clamps to its duration', async () => {
  assert.equal(buildSeekScript(Infinity), null)
  assert.equal(buildSeekScript(-1), null)
  const oldMedia = { src: 'old.mp3', currentSrc: 'old.mp3', paused: true, readyState: 4, currentTime: 5, duration: 40 }
  const activeMedia = { src: 'new.mp3', currentSrc: 'new.mp3', paused: false, readyState: 4, currentTime: 35, duration: 40 }
  const document = {
    querySelectorAll: (selector) => selector === 'audio,video' ? [oldMedia, activeMedia] : [],
    querySelector: () => null,
  }
  const context = { document, setTimeout: (callback) => callback() }
  assert.equal((await vm.runInNewContext(buildSeekScript(50), context)).ok, true)
  assert.equal(activeMedia.currentTime, 40)
  assert.equal(oldMedia.currentTime, 5)
  assert.equal((await vm.runInNewContext(buildSeekScript(12), context)).time, 12)
})

test('playback state follows the playing audio instead of a stale audio element', () => {
  const oldMedia = { src: 'old.mp3', paused: true, ended: false, currentTime: 90, duration: 180 }
  const activeMedia = { src: 'new.mp3', paused: false, ended: false, currentTime: 12, duration: 120 }
  const document = {
    querySelectorAll: (selector) => selector === 'audio,video' ? [oldMedia, activeMedia] : [],
    querySelector: () => null,
  }
  const state = vm.runInNewContext(GET_PLAYBACK_STATE_SCRIPT, {
    document, location: { hash: '#/song?id=2', search: '' },
  })
  assert.equal(state.time, 12)
  assert.equal(state.duration, 120)
})

test('seek falls back to the NetEase player bar when audio is not exposed', async () => {
  let clock = '0:10 / 1:00'
  const progress = {
    getBoundingClientRect: () => ({ left: 100, top: 10, width: 200, height: 8 }),
    dispatchEvent: (event) => { if (event.type === 'click') clock = '0:30 / 1:00' },
  }
  const bar = {
    querySelector: (selector) => {
      if (selector === '.m-pbar .barbg, .m-pbar') return progress
      if (selector === '.m-pbar .time') return { get textContent() { return clock } }
      return null
    },
  }
  const document = {
    querySelectorAll: () => [],
    querySelector: (selector) => selector === '#g_player, .m-playbar' ? bar : null,
  }
  class MouseEvent { constructor(type, init) { this.type = type; Object.assign(this, init) } }
  const result = await vm.runInNewContext(buildSeekScript(30), {
    document, MouseEvent, setTimeout: (callback) => callback(),
  })
  assert.equal(result.ok, true)
  assert.equal(result.time, 30)
})

test('seek exposes player bar coordinates when scripted clicks are ignored', async () => {
  const progress = {
    getBoundingClientRect: () => ({ left: 100, top: 10, width: 200, height: 8 }),
    dispatchEvent: () => false,
  }
  const bar = { querySelector: (selector) => {
    if (selector === '.m-pbar .barbg, .m-pbar') return progress
    if (selector === '.m-pbar .time') return { textContent: '0:10 / 1:00' }
    return null
  } }
  const document = {
    querySelectorAll: () => [],
    querySelector: (selector) => selector === '#g_player, .m-playbar' ? bar : null,
  }
  class MouseEvent { constructor(type, init) { this.type = type; Object.assign(this, init) } }
  const result = await vm.runInNewContext(buildSeekScript(30), {
    document, MouseEvent, setTimeout: (callback) => callback(),
  })
  assert.equal(result.ok, false)
  assert.equal(result.point.x, 200)
  assert.equal(result.point.y, 14)
})

test('playback state reads audio inside the song iframe', () => {
  const media = {
    src: 'https://example.test/song.mp3', currentSrc: 'https://example.test/song.mp3',
    paused: false, ended: false, currentTime: 12, duration: 180,
  }
  const songDocument = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'audio,video' ? [media] : [],
  }
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'iframe' ? [{ contentDocument: songDocument }] : [],
  }
  const state = vm.runInNewContext(GET_PLAYBACK_STATE_SCRIPT, {
    document,
    location: { hash: '#/song?id=3339193481', search: '' },
  })
  assert.equal(state.songId, '3339193481')
  assert.equal(state.playing, true)
  assert.equal(state.time, 12)
  assert.equal(state.duration, 180)
})

test('playback state falls back to the NetEase player bar', () => {
  const bar = {
    querySelector: (selector) => {
      if (selector === '.btns .pas, .btns .ply') return { classList: { contains: (name) => name === 'pas' } }
      if (selector === '.m-pbar .time') return { textContent: '0:12 / 0:00' }
      if (selector === '.m-pbar .cur') return { style: { width: '7%' } }
      if (selector.startsWith('.words .name')) return { getAttribute: () => '/song?id=3339193481' }
      return null
    },
  }
  const document = {
    querySelector: (selector) => selector === '#g_player, .m-playbar' ? bar : null,
    querySelectorAll: () => [],
  }
  const state = vm.runInNewContext(GET_PLAYBACK_STATE_SCRIPT, {
    document,
    location: { hash: '#/song?id=3339193481', search: '' },
  })
  assert.equal(state.playing, true)
  assert.equal(state.time, 12)
  assert.equal(state.duration, 0)
  assert.equal(state.progress, 0.07)
  assert.equal(state.songId, '3339193481')
})

test('playSong with null window getPlaybackState is empty-safe', async () => {
  const panel = createNeteasePanel({ getWindow: () => null })
  // ensureView 未创建前 view 为 null
  const state = await panel.getPlaybackState()
  assert.equal(state.playing, false)
  assert.equal(state.time, 0)
  const toggled = await panel.togglePlayback()
  assert.equal(typeof toggled.ok, 'boolean')
})
