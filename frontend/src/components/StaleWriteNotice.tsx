import { fieldLabel } from '@/lib/staleWrite'

/** Shown by an edit form after it has moved the user's entries onto the latest saved copy. */
export function StaleWriteNotice({ bothChanged, savedUrl }: { bothChanged: string[]; savedUrl: string }) {
  return (
    <div role="alert" className="rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] px-3 py-2 text-sm">
      <p className="font-medium">Someone else saved this while you were editing. Your entries were not saved.</p>
      <p>
        {bothChanged.length > 0
          ? `The form now includes their changes. You both changed: ${bothChanged.map(fieldLabel).join(', ')}. The form shows your entries for these.`
          : 'The form now includes their changes along with yours. You did not change the same fields.'}{' '}
        Check the form, then save again.{' '}
        <a href={savedUrl} target="_blank" rel="noreferrer" className="underline">
          View the saved version in a new tab
        </a>
      </p>
    </div>
  )
}
