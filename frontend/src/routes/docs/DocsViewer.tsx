import { useQuery } from '@tanstack/react-query'
import { BookOpen, Copy, Download, Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'

import { NoAccess } from '@/components/NoAccess'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import {
  canViewDoc,
  DEFAULT_DOC_ID,
  DOC_GROUPS,
  docFileName,
  findDoc,
  loadDocText,
  visibleDocs,
  type DocEntry,
} from '@/routes/docs/docsManifest'
import { MarkdownView } from '@/routes/docs/MarkdownView'
import './docs.css'

interface TocItem {
  id: string
  text: string
  level: number
}

function roleLabel(role: string | undefined): string {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : ''
}

/** Copies text, falling back to a hidden textarea where the async clipboard
 * API is unavailable (insecure origin, older browsers). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function downloadMarkdown(doc: DocEntry, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = docFileName(doc)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * BRD gap Phase 4 / ADR-072 (FR-BRD-01/02): the in-app documentation viewer.
 * `/brd` opens the default document; `/brd/:docId` a specific one. Documents
 * are curated, bundled with the app and filtered by audience: user-facing ones
 * are open to every signed-in user, the engineering set to Admin and Manager.
 */
export function DocsViewer() {
  const { docId } = useParams()
  const { user } = useAuth()
  const location = useLocation()

  if (!docId) return <Navigate to={`/brd/${DEFAULT_DOC_ID}${location.hash}`} replace />

  const doc = findDoc(docId)
  if (!doc) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Documentation" description="Product and engineering documents." />
        <EmptyState
          title="Document not found"
          description="That document doesn't exist in the in-app viewer."
          action={
            <Link to="/brd" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Back to documentation
            </Link>
          }
        />
      </div>
    )
  }
  if (!canViewDoc(user, doc)) return <NoAccess />
  return <DocPage doc={doc} />
}

function DocPage({ doc }: { doc: DocEntry }) {
  const { user } = useAuth()
  const location = useLocation()
  const { show: showToast } = useToast()
  const articleRef = useRef<HTMLElement>(null)
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [docsOpen, setDocsOpen] = useState(isDesktop)
  const [tocOpen, setTocOpen] = useState(isDesktop)
  const [toc, setToc] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const textQuery = useQuery({
    queryKey: ['brd-doc', doc.id],
    queryFn: () => loadDocText(doc),
    staleTime: Infinity,
    retry: 1,
  })
  const markdown = textQuery.data

  const docs = visibleDocs(user)

  // Build the table of contents from the rendered headings (their ids come
  // from rehype-slug), then jump to #section if the URL carries one.
  useEffect(() => {
    const article = articleRef.current
    if (!article || markdown === undefined) return
    const headings = Array.from(article.querySelectorAll<HTMLHeadingElement>('h1, h2, h3')).filter((h) => h.id)
    setToc(headings.map((h) => ({ id: h.id, text: h.textContent ?? '', level: Number(h.tagName[1]) })))
    setActiveId(headings[0]?.id ?? null)
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
      if (target) target.scrollIntoView({ block: 'start' })
    } else {
      window.scrollTo(0, 0)
    }
    // Only when the document (not the hash) changes; hash clicks are native.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, doc.id])

  // Highlight the section being read.
  useEffect(() => {
    const article = articleRef.current
    if (!article || toc.length === 0 || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const first = toc.find((item) => visible.has(item.id))
        if (first) setActiveId(first.id)
      },
      { rootMargin: '-72px 0px -65% 0px' },
    )
    for (const item of toc) {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [toc])

  async function onCopy() {
    if (markdown === undefined) return
    const ok = await copyText(markdown)
    showToast(ok ? 'success' : 'error', ok ? 'Markdown copied to the clipboard' : 'Could not copy — try Download instead')
  }

  const groups = DOC_GROUPS.map((group) => ({
    group,
    items: docs.filter((d) => d.group === group.id),
  })).filter((g) => g.items.length > 0)

  const disabled = markdown === undefined

  return (
    <div className="brd-doc flex flex-col gap-4">
      <PageHeader
        title="Documentation"
        description="Product guides and engineering references, read inside QTestHub."
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={onCopy} disabled={disabled}>
              <Copy className="size-4" aria-hidden="true" /> Copy Markdown
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => markdown !== undefined && downloadMarkdown(doc, markdown)}
              disabled={disabled}
            >
              <Download className="size-4" aria-hidden="true" /> Download .md
            </Button>
            <Button type="button" size="sm" onClick={() => window.print()} disabled={disabled}>
              <Printer className="size-4" aria-hidden="true" /> Print / PDF
            </Button>
          </>
        }
      />
      <p className="qth-type-helper brd-noprint" data-testid="brd-reader">
        <BookOpen className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
        Reading as {user?.name ?? 'you'}
        {user?.role ? ` · ${roleLabel(user.role)}` : ''}
      </p>

      <div className="brd-layout grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="brd-noprint flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <details
            className="brd-panel"
            open={docsOpen}
            onToggle={(e) => setDocsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Documents</summary>
            <nav aria-label="Documents" className="flex flex-col gap-3 pt-1">
              {groups.map(({ group, items }) => (
                <div key={group.id} className="flex flex-col gap-0.5">
                  <p className="qth-type-overline px-2 text-[var(--muted-foreground)]">{group.title}</p>
                  <ul className="flex flex-col gap-0.5">
                    {items.map((item) => (
                      <li key={item.id}>
                        <Link
                          to={`/brd/${item.id}`}
                          aria-current={item.id === doc.id ? 'page' : undefined}
                          className={cn('brd-nav-link', item.id === doc.id && 'brd-nav-link-active')}
                        >
                          {item.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </details>

          {toc.length > 0 && (
            <details
              className="brd-panel"
              open={tocOpen}
              onToggle={(e) => setTocOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>On this page</summary>
              <nav aria-label="On this page" className="pt-1">
                <ul className="flex flex-col gap-0.5">
                  {toc.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        aria-current={item.id === activeId ? 'location' : undefined}
                        className={cn(
                          'brd-nav-link',
                          item.level === 3 && 'brd-toc-l3',
                          item.level === 1 && 'font-medium',
                          item.id === activeId && 'brd-nav-link-active',
                        )}
                      >
                        {item.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </details>
          )}
        </div>

        <div className="min-w-0">
          {textQuery.isPending && (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading document">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {textQuery.isError && (
            <ErrorState
              message="This document could not be loaded."
              error={textQuery.error}
              onRetry={() => textQuery.refetch()}
            />
          )}
          {markdown !== undefined && (
            <article
              ref={articleRef}
              id="brd-article"
              aria-label={doc.title}
              className="brd-prose brd-print-area"
              data-doc={doc.id}
            >
              <MarkdownView source={markdown} user={user} />
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
