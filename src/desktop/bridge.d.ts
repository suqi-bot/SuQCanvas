export {}

declare global {
  interface Window {
    suqDesktop?: {
      aiRequest: (request: { url: string; method: 'GET' | 'POST'; key?: string; body?: string }) => Promise<{ status: number; contentType: string; base64: string }>
      ready: () => void
      onOpenProject: (callback: (file: { name: string; bytes: Uint8Array<ArrayBuffer> }) => void) => () => void
      onBeforeClose: (callback: () => void) => () => void
      closeReady: (ok: boolean) => void
      saveFile: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>
      showDataDirectory: () => Promise<string>
    }
  }
}
