import { useUiStore } from '../store/uiStore'

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const removeToast = useUiStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => removeToast(t.id)}
          className={`sq-toast sq-toast-${t.kind}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
