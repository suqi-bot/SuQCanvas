import { create } from 'zustand'

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
  managerOpen: boolean
  setManagerOpen: (open: boolean) => void
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
  managerOpen: false,
  setManagerOpen: (open) => {
    set({ managerOpen: open })
  },
}))

export function toast(message: string, kind: ToastKind = 'info'): void {
  useUiStore.getState().pushToast(message, kind)
}
