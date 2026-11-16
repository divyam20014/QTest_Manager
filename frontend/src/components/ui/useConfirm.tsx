import { useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export type ConfirmRequest = {
  title: string
  /** Say what will be lost and whether it can be undone. */
  description: string
  confirmLabel?: string
  requireText?: string
  /** Defaults to true; set false for hard-to-reverse but not destructive actions. */
  destructive?: boolean
  /**
   * The action. Return the mutation's promise (`mutateAsync`) to keep the
   * dialog open, with the confirm button disabled, until it settles -- that is
   * what prevents a double submit. A rejection is swallowed here because the
   * mutation's own onError already shows the failure toast.
   */
  run: () => unknown
}

/**
 * Hook form of ConfirmDialog for list rows: call `ask({...})` from the
 * destructive button and render `dialog` once near the end of the component.
 * Destructive styling is the default; pass `destructive: false` for actions
 * that are hard to reverse but not destructive (e.g. finishing a run).
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [pending, setPending] = useState(false)

  async function confirm() {
    if (!request || pending) return
    setPending(true)
    try {
      await request.run()
    } catch {
      // surfaced by the mutation's onError toast
    } finally {
      setPending(false)
      setRequest(null)
    }
  }

  const dialog = (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ''}
      description={request?.description ?? ''}
      confirmLabel={request?.confirmLabel ?? 'Delete'}
      requireText={request?.requireText}
      destructive={request?.destructive ?? true}
      pending={pending}
      onConfirm={() => void confirm()}
      onClose={() => {
        if (!pending) setRequest(null)
      }}
    />
  )

  return { ask: setRequest, dialog }
}
