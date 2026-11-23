import { useId, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const REMARK_PLUGINS = [remarkGfm]

// Styled through tokens only. Raw HTML in the text is never executed (react-markdown
// renders it as text, no rehype-raw), and the API strips it on save (no HTML storage).
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-2 text-base font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-2 text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-2 text-sm font-semibold">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2 text-sm font-semibold">{children}</h4>,
  p: ({ children }) => <p className="break-words">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[var(--border)] pl-3 text-[var(--muted-foreground)]">{children}</blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cn('rounded-md bg-[var(--muted)] px-1 py-0.5 font-mono text-[0.85em]', className)}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre tabIndex={0} className="overflow-x-auto rounded-md bg-[var(--muted)] p-2 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  a: ({ href, children }) =>
    href && /^(https?:|mailto:)/i.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--link)] underline underline-offset-2">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  table: ({ children }) => (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-[var(--border)] px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-[var(--border)] px-2 py-1">{children}</td>,
}

/** Read-only rendering of Markdown text (description, preconditions, ...). */
export function MarkdownText({ source, className, empty = '—' }: { source: string | null | undefined; className?: string; empty?: ReactNode }) {
  if (!source || !source.trim()) return <span className="text-[var(--muted-foreground)]">{empty}</span>
  return (
    <div className={cn('flex flex-col gap-2 text-sm', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {source}
      </ReactMarkdown>
    </div>
  )
}

/**
 * A Markdown field: a Write / Preview toggle over a plain textarea. Only Markdown
 * text is edited and stored; there is no HTML mode.
 */
export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  onBlur,
  required,
  error,
  helper,
  rows = 5,
  maxLength,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  required?: boolean
  error?: string
  helper?: ReactNode
  rows?: number
  maxLength?: number
  disabled?: boolean
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const panelId = useId()
  const errorId = error ? `${id}-error` : undefined
  const helperId = helper ? `${id}-helper` : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
        <div role="tablist" aria-label={`${label} mode`} className="inline-flex rounded-md border border-[var(--border)] p-0.5 text-xs">
          {(['write', 'preview'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              id={`${panelId}-${mode}`}
              aria-selected={tab === mode}
              aria-controls={`${panelId}-panel`}
              onClick={() => setTab(mode)}
              className={cn(
                'rounded-md px-2 py-1 capitalize focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:min-h-9',
                tab === mode
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div id={`${panelId}-panel`} role="tabpanel" aria-labelledby={`${panelId}-${tab}`}>
        {tab === 'write' ? (
          <Textarea
            id={id}
            rows={rows}
            value={value}
            maxLength={maxLength}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={[helperId, errorId].filter(Boolean).join(' ') || undefined}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
        ) : (
          <div className="min-h-16 rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3">
            <MarkdownText source={value} empty="Nothing to preview yet." />
          </div>
        )}
      </div>
      {helper && (
        <p id={helperId} className="text-xs text-[var(--muted-foreground)]">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[var(--destructive)]">
          {error}
        </p>
      )}
    </div>
  )
}
