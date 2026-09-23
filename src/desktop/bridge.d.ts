export {}

declare global {
  interface Window {
    suqDesktop?: {
      aiRequest: (request: { requestId?: string; url: string; method: 'GET' | 'POST'; key?: string; body?: string; upload?: { base64: string; name: string; type: string; fields?: Record<string, string> } }) => Promise<{ status: number; contentType: string; base64: string }>
      cancelAiRequest?: (requestId: string) => void
      ready: () => void
      onOpenProject: (callback: (file: { name: string; bytes: Uint8Array<ArrayBuffer> }) => void) => () => void
      onBeforeClose: (callback: () => void) => () => void
      closeReady: (ok: boolean) => void
      saveFile: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>
      showDataDirectory: () => Promise<string>
      /** 读取 userData/ai-credentials.json */
      readAiCredentials: () => Promise<{ comfyKey?: string; cloudKey?: string; llmKey?: string }>
      /** 写入 userData/ai-credentials.json */
      writeAiCredentials: (credentials: { comfyKey: string; cloudKey: string; llmKey: string }) => Promise<boolean>
      /** 打开/显示网易云嵌入面板（可带目标 URL 与宿主区域 bounds） */
      neteaseOpen?: (payload: {
        url?: string
        bounds?: { x: number; y: number; width: number; height: number }
      }) => Promise<{ ok: boolean; url?: string }>
      /** 在已打开的面板内跳转 */
      neteaseNavigate?: (payload: { url: string }) => Promise<{ ok: boolean; url?: string }>
      /** 同步 WebContentsView 矩形（视口坐标） */
      neteaseLayout?: (bounds: { x: number; y: number; width: number; height: number }) => void
      /** 暂停面板内正在播放的媒体（本地起播互斥） */
      neteasePause?: () => Promise<boolean>
      /** 尽力起播当前页媒体（点歌后） */
      neteaseTryPlay?: () => Promise<boolean>
      /** 画布点播：导航到指定 song 并校验起播 */
      neteasePlaySong?: (songId: string) => Promise<{
        ok: boolean
        stage?: string
        expectedId?: string
        actualId?: string
        hash?: string
        message?: string
      }>
      /** 读取页内播放状态（进度/暂停/当前 song id） */
      neteasePlaybackState?: () => Promise<{
        songId: string
        playing: boolean
        ended: boolean
        time: number
        duration: number
        progress: number
        hash: string
      }>
      /** 播放/暂停切换 */
      neteaseToggle?: () => Promise<{ ok: boolean; playing?: boolean; paused?: boolean; message?: string }>
      neteaseSeekTo?: (time: number) => Promise<{ ok: boolean; time?: number }>
      /** 登录后拉取「我喜欢的音乐」 */
      neteaseFetchLiked?: () => Promise<
        | { ok: true; playlistId: string; playlistName: string; songs: NeteaseLikedSong[] }
        | { ok: false; stage: string; message: string }
      >
      /** 全部用户歌单 */
      neteaseFetchPlaylists?: () => Promise<
        { ok: true; playlists: NeteasePlaylist[] } | { ok: false; stage: string; message: string }
      >
      /** 指定歌单歌曲 */
      neteaseFetchPlaylistSongs?: (playlistId: string) => Promise<
        | { ok: true; playlistId: string; playlistName: string; songs: NeteaseLikedSong[] }
        | { ok: false; stage: string; message: string }
      >
      /** 搜索网易云歌曲 */
      neteaseSearch?: (query: string) => Promise<
        { ok: true; songs: NeteaseLikedSong[] } | { ok: false; message: string }
      >
      /** 临时露出网易云网页（仅登录用） */
      neteaseShowBrowser?: (bounds?: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean }>
      /** 藏起网页，只留列表 UI */
      neteaseHideBrowser?: () => Promise<{ ok: boolean }>
      /** 是否已登录账号 */
      neteaseLoggedIn?: () => Promise<boolean>
      /** 关闭/摘除面板（登录 Cookie 保留在 persist:netease） */
      neteaseClose?: () => void
    }
  }
}

/** 用户歌单摘要 */
interface NeteasePlaylist {
  id: string
  name: string
  trackCount?: number
  coverUrl?: string
  specialType?: number
}

/** 侧栏「我喜欢的音乐」单曲 */
interface NeteaseLikedSong {
  id: string
  name: string
  artist?: string
  coverUrl?: string
}
