import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { useConfirm } from '@/components/ui/useConfirm'

/**
 * Dirty-form guard for a full-page form: closing the tab / reloading asks the
 * browser to confirm, and so does following any in-app link or the page's own Cancel
 * button (`leave`). Render `dialog` once. (The app uses a plain BrowserRouter, which
 * has no navigation blocker, so in-app links are intercepted at the document.)
 */
export function useUnsavedGuard(dirty: boolean) {
  const navigate = useNavigate()
  const { ask, dialog } = useConfirm()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  function askToLeave(go: () => void) {
    ask({
      title: 'Discard unsaved changes?',
      description: 'You have changes that are not saved. If you leave now they are lost.',
      confirmLabel: 'Discard changes',
      run: go,
    })
  }

  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const to = url.pathname + url.search + url.hash
      if (to === window.location.pathname + window.location.search + window.location.hash) return
      e.preventDefault()
      e.stopPropagation()
      askToLeave(() => navigate(to))
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  /** Run `go` now, or after the user confirms discarding the edits. */
  function leave(go: () => void) {
    if (dirtyRef.current) askToLeave(go)
    else go()
  }

  return { leave, dialog }
}
