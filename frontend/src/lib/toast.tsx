import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

// 'info' / 'warning' added in design-system Phase B (same palette as the
// matching --status-* tokens); existing callers only use success/error.
type ToastVariant = 'success' | 'error' | 'info' | 'warning'

const VARIANT_STYLE: Record<ToastVariant, string> = {
  success: 'border-[var(--status-good)]/30 bg-[var(--status-good-bg)] text-[var(--status-good)]',
  error: 'border-[var(--status-serious)]/30 bg-[var(--status-serious-bg)] text-[var(--status-serious)]',
  info: 'border-[var(--status-info)]/30 bg-[var(--status-info-bg)] text-[var(--status-info)]',
  warning: 'border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] text-[var(--status-warning)]',
}

const VARIANT_ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle } as const

function ToastIcon({ variant }: { variant: ToastVariant }) {
  const Icon = VARIANT_ICON[variant]
  return <Icon className="mt-0.5 size-4 shrink-0" />
}

interface Toast {
  id: number
  variant: ToastVariant
  message: string
}

interface ToastContextValue {
  show: (variant: ToastVariant, message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const AUTO_DISMISS_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, variant, message }])
    },
    [],
  )

  const value = useMemo(() => ({ show }), [show])

  // UX-018: Escape dismisses every visible toast.
  useEffect(() => {
    if (toasts.length === 0) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setToasts([])
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toasts.length])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* UX-009: below md the toast stack sits above the bottom tab bar and
          the iOS home-indicator inset instead of on top of them. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-end gap-2 md:inset-x-auto md:bottom-4 md:right-4">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// One toast: auto-dismisses after AUTO_DISMISS_MS, but the countdown pauses
// while the pointer is over it or focus is inside it, and restarts after.
// Errors use role="alert" (announced immediately); the rest role="status".
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [paused, toast.id, onDismiss])

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={
        'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3.5 py-3 text-sm shadow-lg md:w-auto ' +
        VARIANT_STYLE[toast.variant]
      }
    >
      <ToastIcon variant={toast.variant} />
      <span className="min-w-0 flex-1 text-[var(--foreground)]">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-my-1 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:size-11"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
