import { Unlink } from 'lucide-react'
import { Link } from 'react-router-dom'

import { listDefectsPage } from '@/api/defects'
import { listTestCases } from '@/api/testCases'
import { SearchPicker, type PickItem } from '@/components/SearchPicker'
import { IconButton } from '@/components/ui/icon-button'
import { DefectStatusBadge } from './DefectStatusBadge'

/** Finds test cases of one project by Test Case ID or title (the server's search covers both). */
export function TestCasePicker({
  id,
  projectId,
  excludeIds,
  onPick,
  label = 'Link a test case',
  disabled,
  hint,
}: {
  id: string
  projectId: string
  excludeIds?: string[]
  onPick: (item: PickItem) => void
  label?: string
  disabled?: boolean
  hint?: string
}) {
  return (
    <SearchPicker
      id={id}
      label={label}
      queryKey={['test-cases', projectId]}
      disabled={disabled || !projectId}
      excludeIds={excludeIds}
      onPick={onPick}
      placeholder="Search by Test Case ID or title"
      emptyText="No test case matches"
      hint={hint ?? (projectId ? undefined : 'Choose a project first.')}
      search={async (query) => {
        const page = await listTestCases(projectId, { search: query || undefined, page_size: 10, sort: '-created_at' })
        return page.items.map((tc) => ({
          id: tc.id,
          primary: tc.display_id ?? tc.id.slice(0, 8),
          secondary: tc.title,
          detail: tc.module_path ?? undefined,
        }))
      }}
    />
  )
}

/** Finds defects of one project by Bug ID or title. */
export function DefectPicker({
  id,
  projectId,
  excludeIds,
  onPick,
  label = 'Find a defect',
  disabled,
}: {
  id: string
  projectId: string
  excludeIds?: string[]
  onPick: (item: PickItem) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <SearchPicker
      id={id}
      label={label}
      queryKey={['defects', projectId]}
      disabled={disabled}
      excludeIds={excludeIds}
      onPick={onPick}
      placeholder="Search by Bug ID or title"
      emptyText="No defect matches"
      search={async (query) => {
        const page = await listDefectsPage({ project_id: projectId, search: query || undefined, page_size: 10 })
        return page.items.map((d) => ({
          id: d.id,
          primary: d.display_id ?? d.id.slice(0, 8),
          secondary: d.title,
          detail: <DefectStatusBadge status={d.status} label={d.status_label} />,
        }))
      }}
    />
  )
}

/** Chips for the chosen test cases: the Test Case ID links to the case, the button unlinks it. */
export function TestCaseChips({
  items,
  onRemove,
  disabled,
}: {
  items: { id: string; display_id: string | null; title: string }[]
  onRemove: (id: string) => void
  disabled?: boolean
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No test case linked yet.</p>
  }
  return (
    <ul aria-label="Linked test cases" className="flex flex-wrap gap-2">
      {items.map((tc) => (
        <li
          key={tc.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] py-0.5 pl-3 pr-1 text-xs"
        >
          <Link to={`/test-cases/${tc.id}`} className="shrink-0 font-mono underline-offset-2 hover:underline">
            {tc.display_id ?? tc.id.slice(0, 8)}
          </Link>
          <span className="min-w-0 truncate">{tc.title}</span>
          <IconButton
            size="sm"
            disabled={disabled}
            aria-label={`Unlink ${tc.display_id ?? tc.title}`}
            onClick={() => onRemove(tc.id)}
            className="size-6 max-md:size-9"
          >
            <Unlink aria-hidden="true" />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}
