import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { CloseIcon, PlayIcon, SearchIcon } from '../canvas/nodes/Icons'
import { NETEASE_DRAG_MIME, type NeteaseDragPayload } from '../media/netease'
import { registerNeteaseLoginHost, useNeteaseStore, type NeteaseLikedSong } from '../store/neteaseStore'
import { IS_DESKTOP_BUILD } from '../buildMode'

function toPayload(song: NeteaseLikedSong): NeteaseDragPayload {
  return { id: song.id, name: song.name, artist: song.artist, coverUrl: song.coverUrl }
}

function SongRow({
  song,
  index,
  showIndex,
  onPlay,
}: {
  song: NeteaseLikedSong
  index: number
  showIndex?: boolean
  onPlay: (id: string) => void
}) {
  const onDragStart = (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData(NETEASE_DRAG_MIME, JSON.stringify(toPayload(song)))
    event.dataTransfer.setData('text/plain', song.name)
    event.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <li
      draggable
      onDragStart={onDragStart}
      title="拖到画布生成节点；点击播放"
      className="group flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-hover active:cursor-grabbing"
    >
      {showIndex !== false && (
        <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-dim">{index + 1}</span>
      )}
      {song.coverUrl ? (
        <img
          src={song.coverUrl}
          alt=""
          draggable={false}
          className="h-7 w-7 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--well)] text-dim">
          <PlayIcon className="text-[10px]" />
        </span>
      )}
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onPlay(song.id)}>
        <span className="block truncate text-main group-hover:text-rose-500">{song.name}</span>
        {song.artist ? <span className="block truncate text-[10px] text-dim">{song.artist}</span> : null}
      </button>
    </li>
  )
}

/**
 * 网易云侧栏：搜索 + 全部歌单（点选加载歌曲）。
 * 「登录」时列表隐藏，登录页铺满标题栏以下区域并加宽面板。
 */
export function NeteasePanel() {
  const open = useNeteaseStore((s) => s.open)
  const closePanel = useNeteaseStore((s) => s.closePanel)
  const playlists = useNeteaseStore((s) => s.playlists)
  const playlistsLoading = useNeteaseStore((s) => s.playlistsLoading)
  const playlistsError = useNeteaseStore((s) => s.playlistsError)
  const selectedPlaylistId = useNeteaseStore((s) => s.selectedPlaylistId)
  const selectPlaylist = useNeteaseStore((s) => s.selectPlaylist)
  const refreshPlaylists = useNeteaseStore((s) => s.refreshPlaylists)
  const liked = useNeteaseStore((s) => s.liked)
  const likedLoading = useNeteaseStore((s) => s.likedLoading)
  const likedError = useNeteaseStore((s) => s.likedError)
  const playLikedSong = useNeteaseStore((s) => s.playLikedSong)
  const searchQuery = useNeteaseStore((s) => s.searchQuery)
  const searchResults = useNeteaseStore((s) => s.searchResults)
  const searchLoading = useNeteaseStore((s) => s.searchLoading)
  const searchError = useNeteaseStore((s) => s.searchError)
  const setSearchQuery = useNeteaseStore((s) => s.setSearchQuery)
  const runSearch = useNeteaseStore((s) => s.runSearch)
  const clearSearch = useNeteaseStore((s) => s.clearSearch)
  const loginVisible = useNeteaseStore((s) => s.loginVisible)
  const showLogin = useNeteaseStore((s) => s.showLogin)
  const hideLogin = useNeteaseStore((s) => s.hideLogin)
  const loggedIn = useNeteaseStore((s) => s.loggedIn)
  const loginHostRef = useRef<HTMLDivElement | null>(null)
  const [submitted, setSubmitted] = useState('')

  useLayoutEffect(() => {
    registerNeteaseLoginHost(loginVisible ? loginHostRef.current : null)
    if (!loginVisible) return
    const el = loginHostRef.current
    if (!el) return
    const push = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 40) return
      void window.suqDesktop?.neteaseLayout?.({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }
    push()
    const observer = new ResizeObserver(push)
    observer.observe(el)
    window.addEventListener('resize', push)
    const t1 = window.setTimeout(push, 50)
    const t2 = window.setTimeout(push, 200)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', push)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      registerNeteaseLoginHost(null)
    }
  }, [loginVisible])

  useEffect(() => {
    if (!open || !IS_DESKTOP_BUILD) return
    void useNeteaseStore.getState().checkLogin()
    if (!useNeteaseStore.getState().playlists.length && !useNeteaseStore.getState().playlistsLoading) {
      void useNeteaseStore.getState().refreshPlaylists()
    }
  }, [open])

  if (!open) return null

  const onSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(searchQuery.trim())
    void runSearch()
  }

  return (
    <aside
      className={`fixed bottom-0 right-0 top-14 z-[70] flex flex-col border-l border-edge bg-panel shadow-[-8px_0_24px_rgba(0,0,0,0.25)] transition-[width] duration-150 ${
        loginVisible ? 'w-[min(640px,78vw)]' : 'w-[min(420px,46vw)]'
      }`}
      aria-label="网易云音乐"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-main">
          {loginVisible ? '网易云登录' : '网易云音乐'}
        </span>
        {!loginVisible && (
          <span className={`text-[10px] ${loggedIn ? 'text-emerald-500' : 'text-dim'}`}>
            {loggedIn === true ? '已登录' : loggedIn === false ? '未登录' : ''}
          </span>
        )}
        <button
          type="button"
          onClick={() => (loginVisible ? void hideLogin() : void showLogin())}
          className={`rounded border px-2 py-0.5 text-[11px] ${
            loginVisible
              ? 'border-rose-500/60 bg-rose-500 text-white hover:bg-rose-400'
              : 'border-edge2 text-soft hover:border-rose-500/50 hover:text-main'
          }`}
          title={loginVisible ? '完成登录并返回歌单列表' : '打开登录页（铺满下方区域）'}
        >
          {loginVisible ? '完成登录' : '登录'}
        </button>
        <button
          type="button"
          title="关闭面板"
          className="rounded p-1 text-mid hover:bg-hover hover:text-main"
          onClick={closePanel}
        >
          <CloseIcon />
        </button>
      </div>

      {loginVisible && IS_DESKTOP_BUILD ? (
        <div ref={loginHostRef} className="min-h-0 flex-1 bg-slate-100" />
      ) : (
        <>
          {/* 搜索 */}
          <form onSubmit={onSearchSubmit} className="flex shrink-0 gap-1.5 border-b border-edge px-2.5 py-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索歌曲，回车或点搜索"
                className="w-full rounded-md border border-edge2 bg-panel2 py-1.5 pl-7 pr-2 text-xs text-main outline-none focus:border-rose-500"
              />
            </div>
            <button
              type="submit"
              disabled={searchLoading}
              className="shrink-0 rounded-md bg-rose-500 px-2.5 text-xs font-medium text-white hover:bg-rose-400 disabled:opacity-40"
            >
              {searchLoading ? '…' : '搜索'}
            </button>
            {searchResults && (
              <button
                type="button"
                onClick={clearSearch}
                className="shrink-0 rounded-md border border-edge2 px-2 text-xs text-soft hover:bg-hover"
              >
                清空
              </button>
            )}
          </form>

          {/* 搜索结果 */}
          {(searchResults || searchError) && (
            <section className="max-h-[30%] min-h-0 shrink-0 overflow-y-auto border-b border-edge px-2 py-1.5">
              <div className="mb-1 px-1 text-[11px] font-medium text-main">
                搜索{submitted ? `「${submitted}」` : ''}
                {searchResults ? <span className="ml-1 text-dim">· {searchResults.length}</span> : null}
              </div>
              {searchError && (
                <p className="mb-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500">{searchError}</p>
              )}
              {searchResults && searchResults.length > 0 && (
                <ul className="space-y-0.5">
                  {searchResults.map((song, i) => (
                    <SongRow key={`s-${song.id}-${i}`} song={song} index={i} showIndex={false} onPlay={playLikedSong} />
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* 全部歌单（横向） */}
          <section className="shrink-0 border-b border-edge">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 text-[11px] font-medium text-main">
                我的歌单
                {playlists.length ? <span className="ml-1 text-dim">· {playlists.length}</span> : null}
              </span>
              <button
                type="button"
                disabled={playlistsLoading}
                onClick={() => void refreshPlaylists()}
                className="rounded border border-edge2 px-1.5 py-0.5 text-[10px] text-soft hover:border-rose-500/50 hover:text-main disabled:opacity-40"
              >
                {playlistsLoading ? '读取中…' : '刷新'}
              </button>
            </div>
            {playlistsError && (
              <p className="mx-2 mb-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-500">
                {playlistsError}
              </p>
            )}
            {!playlists.length && !playlistsError && !playlistsLoading && (
              <p className="px-3 pb-2 text-[10px] text-dim">
                {loggedIn === false ? '点「登录」完成后再刷新。' : '点「刷新」读取你的全部歌单。'}
              </p>
            )}
            {playlists.length > 0 && (
              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto px-2 pb-2">
                {playlists.map((pl) => {
                  const active = pl.id === selectedPlaylistId
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => void selectPlaylist(pl.id)}
                      title={`${pl.name}${pl.trackCount ? ` · ${pl.trackCount} 首` : ''}`}
                      className={`max-w-[9.5rem] truncate rounded-full border px-2 py-0.5 text-[10px] ${
                        active
                          ? 'border-rose-500/70 bg-rose-500/15 text-rose-500'
                          : 'border-edge2 text-soft hover:border-rose-500/40 hover:text-main'
                      }`}
                    >
                      {pl.name}
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* 当前歌单歌曲 */}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-main">
                {liked?.playlistName || '歌曲列表'}
                {liked ? <span className="ml-1 text-dim">· {liked.songs.length} 首</span> : null}
              </span>
              {selectedPlaylistId && (
                <button
                  type="button"
                  disabled={likedLoading}
                  onClick={() => void selectPlaylist(selectedPlaylistId)}
                  className="rounded border border-edge2 px-1.5 py-0.5 text-[10px] text-soft hover:border-rose-500/50 hover:text-main disabled:opacity-40"
                >
                  {likedLoading ? '加载中…' : '重载'}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {likedLoading && (
                <p className="px-1 py-2 text-[10px] text-dim">正在读取歌曲…</p>
              )}
              {likedError && !likedLoading && (
                <p className="mb-1 rounded bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-500">
                  {likedError}
                </p>
              )}
              {!liked && !likedError && !likedLoading && (
                <p className="px-1 py-2 text-[10px] leading-relaxed text-dim">
                  选择上方任一歌单，歌曲可拖到画布。
                </p>
              )}
              {liked && liked.songs.length === 0 && !likedError && (
                <p className="px-1 py-2 text-[10px] text-dim">歌单为空</p>
              )}
              {liked && liked.songs.length > 0 && (
                <ul className="space-y-0.5">
                  {liked.songs.map((song, i) => (
                    <SongRow key={`l-${song.id}-${i}`} song={song} index={i} onPlay={playLikedSong} />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {!IS_DESKTOP_BUILD && (
            <p className="border-t border-edge px-3 py-2 text-[10px] text-dim">
              浏览器版不支持应用内登录/搜索，请在桌面版使用。
            </p>
          )}
        </>
      )}
    </aside>
  )
}
