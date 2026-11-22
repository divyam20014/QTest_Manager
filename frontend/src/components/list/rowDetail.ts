import type { HTMLAttributes, KeyboardEvent, MouseEvent } from 'react'

const SNIPPET_LENGTH = 280

export function snippet(text: string, max = SNIPPET_LENGTH): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="combobox"], [role="menuitem"], [data-no-row-open]'

/**
 * Props for a table row that opens the detail drawer: a click anywhere on the
 * row except on a link / checkbox / button / form control, and Enter while the
 * row itself has keyboard focus. The title stays an ordinary link to the full
 * page. Pass to ResponsiveTable's `rowProps`.
 */
export function rowDetailProps(onOpen: () => void): HTMLAttributes<HTMLTableRowElement> & { 'data-row-detail': string } {
  return {
    'data-row-detail': 'true',
    tabIndex: 0,
    className: 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
    onClick: (event: MouseEvent<HTMLTableRowElement>) => {
      if ((event.target as HTMLElement).closest(INTERACTIVE)) return
      onOpen()
    },
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) {
        event.preventDefault()
        onOpen()
      }
    },
  }
}

