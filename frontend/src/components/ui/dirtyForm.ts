import { createContext, useContext, useEffect } from 'react'

// Unsaved-changes guard (Phase F). A form inside a Dialog/Drawer reports
// whether it has unsaved edits (`useReportDirty(isDirty)`); closing the overlay
// by Escape, backdrop click or the X then asks before discarding. Closing from
// the parent (after a successful save, the Cancel button) is unaffected.
export const DirtyContext = createContext<((dirty: boolean) => void) | null>(null)

/** Tell the surrounding Dialog/Drawer whether the form has unsaved changes. No-op outside one. */
export function useReportDirty(dirty: boolean) {
  const report = useContext(DirtyContext)
  useEffect(() => {
    report?.(dirty)
    return () => report?.(false)
  }, [report, dirty])
}

/** Render inside a Dialog/Drawer when the form state lives in a parent that sits
 * outside the overlay (so `useReportDirty` can't be called there directly). */
export function ReportDirty({ dirty }: { dirty: boolean }): null {
  useReportDirty(dirty)
  return null
}
