export {}

declare global {
  interface Window {
    suqDesktop?: {
      ready: () => void
      onOpenProject: (callback: (file: { name: string; bytes: Uint8Array<ArrayBuffer> }) => void) => () => void
      onBeforeClose: (callback: () => void) => () => void
      closeReady: (ok: boolean) => void
      saveFile: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>
      showDataDirectory: () => Promise<string>
    }
  }
}
