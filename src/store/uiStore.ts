import { create } from 'zustand'

export type ToolMode = 'select' | 'connect' | 'drag'

export type ToastKind = 'info' | 'error' | 'success'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface UiState {
  toasts: ToastItem[]
  pushToast: (message: string, kind?: ToastKind) => void
  removeToast: (id: number) => void
  importQueue: { files: File[]; atCenter: boolean } | null
  requestImport: (files: File[], atCenter?: boolean) => void
  consumeImport: () => { files: File[]; atCenter: boolean } | null
  pdfViewer: { assetId: string; name: string } | null
  openPdfViewer: (assetId: string, name: string) => void
  closePdfViewer: () => void
  imageViewer: { assetId: string; name: string; thumbnail?: boolean } | null
  openImageViewer: (assetId: string, name: string, thumbnail?: boolean) => void
  closeImageViewer: () => void
  markdownViewer: { assetId: string; name: string; nodeId?: string } | null
  openMarkdownViewer: (assetId: string, name: string, nodeId?: string) => void
  closeMarkdownViewer: () => void
  fileManagerOpen: boolean
  setFileManagerOpen: (open: boolean) => void
  playerTarget: string | null
  openMusicPlayer: (assetId: string) => void
  homeOpen: boolean
  setHomeOpen: (open: boolean) => void
  tool: ToolMode
  setTool: (tool: ToolMode) => void
}

let toastId = 0

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  pushToast: (message, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, message, kind }] })
    setTimeout(() => get().removeToast(id), 3200)
  },
  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  importQueue: null,
  requestImport: (files, atCenter = true) => {
    if (files.length === 0) return
    set({ importQueue: { files: [...files], atCenter } })
  },
  consumeImport: () => {
    const queue = get().importQueue
    set({ importQueue: null })
    return queue
  },
  pdfViewer: null,
  openPdfViewer: (assetId, name) => {
    set({ pdfViewer: { assetId, name } })
  },
  closePdfViewer: () => {
    set({ pdfViewer: null })
  },
  imageViewer: null,
  openImageViewer: (assetId, name, thumbnail) => {
    set({ imageViewer: { assetId, name, thumbnail } })
  },
  closeImageViewer: () => {
    set({ imageViewer: null })
  },
  markdownViewer: null,
  openMarkdownViewer: (assetId, name, nodeId) => {
    set({ markdownViewer: { assetId, name, nodeId } })
  },
  closeMarkdownViewer: () => {
    set({ markdownViewer: null })
  },
  fileManagerOpen: false,
  setFileManagerOpen: (fileManagerOpen) => {
    set({ fileManagerOpen })
  },
  playerTarget: null,
  openMusicPlayer: (assetId) => {
    set({ playerTarget: assetId, fileManagerOpen: true })
  },
  homeOpen: false,
  setHomeOpen: (open) => {
    set({ homeOpen: open })
  },
  tool: 'select',
  setTool: (tool) => {
    set({ tool })
  },
}))

export function toast(message: string, kind: ToastKind = 'info'): void {
  useUiStore.getState().pushToast(message, kind)
}
