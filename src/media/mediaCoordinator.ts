// 全局媒体互斥：同一时刻最多一个音频和一个视频在播放。
// 任意媒体元素触发 play 时，自动暂停同类型的其他元素。

const audioElements = new Set<HTMLAudioElement>()
const videoElements = new Set<HTMLVideoElement>()

function makeRegistrar<T extends HTMLMediaElement>(elements: Set<T>): (el: T) => () => void {
  return (el) => {
    elements.add(el)
    const onPlay = () => {
      for (const other of elements) {
        if (other !== el && !other.paused) other.pause()
      }
    }
    el.addEventListener('play', onPlay)
    return () => {
      elements.delete(el)
      el.removeEventListener('play', onPlay)
    }
  }
}

export const registerAudio = makeRegistrar(audioElements)
export const registerVideo = makeRegistrar(videoElements)
