import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { isAdmin, isManagerOrAbove } from '@/api/auth'
import { getUserGuide } from '@/api/userGuide'
import { Combobox } from '@/components/ui/combobox'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/routes/docs/MarkdownView'
import { defaultSectionId, sectionFromHash } from '@/routes/userGuide/sections'
import '@/routes/docs/docs.css'

function GuideSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading the user guide">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

/**
 * The User Guide (ADR-114): role-based sections of docs/USER_GUIDE.md. The API
 * returns only the sections this user's permissions allow, so a section that is
 * not listed here is not in the payload either. Deep link: `/user-guide#tester`.
 */
export function UserGuide() {
  const { user } = useAuth()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const query = useQuery({
    // Keyed by user so a cached guide is never shown to someone else on this tab.
    queryKey: ['user-guide', user?.user_id],
    queryFn: getUserGuide,
    staleTime: 60_000,
  })
  const sections = query.data?.sections ?? []
  const tier = isAdmin(user) ? 'admin' : isManagerOrAbove(user) ? 'manager' : 'tester'
  const activeId = sectionFromHash(sections, hash) ?? defaultSectionId(sections, tier)
  const active = sections.find((s) => s.id === activeId)

  // A new section starts at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeId])

  return (
    <div className="brd-doc flex flex-col gap-4">
      <PageHeader title="User Guide" description="How to use QTestHub, for your role." />

      {query.isPending && <GuideSkeleton />}
      {query.isError && (
        <ErrorState message="The user guide could not be loaded." error={query.error} onRetry={() => query.refetch()} />
      )}
      {query.isSuccess && sections.length === 0 && (
        <EmptyState title="No guide available" description="There are no guide sections for your account yet." />
      )}
      {query.isSuccess && active && (
        <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <div className="lg:hidden">
              <Combobox
                aria-label="Guide section"
                value={active.id}
                onChange={(id) => navigate({ hash: `#${id}` }, { replace: true })}
                options={sections.map((s) => ({ value: s.id, label: s.title }))}
                searchable={false}
              />
            </div>
            <nav aria-label="Guide sections" className="hidden lg:block">
              <ul className="space-y-0.5">
                {sections.map((s) => {
                  const isActive = s.id === active.id
                  return (
                    <li key={s.id}>
                      <Link
                        to={{ hash: `#${s.id}` }}
                        replace
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'relative flex min-h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-sm transition-colors',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                          isActive
                            ? 'bg-[var(--primary)]/10 font-medium text-[var(--foreground)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--primary)]'
                            : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
                        )}
                      >
                        <BookOpen className="size-4 shrink-0" aria-hidden="true" />
                        {s.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>
          </div>

          <article
            id="user-guide-article"
            aria-label={active.title}
            className="brd-prose min-w-0"
            data-section={active.id}
          >
            <h2 id={`guide-${active.id}`}>{active.title}</h2>
            <MarkdownView source={active.markdown} docs={[]} />
          </article>
        </div>
      )}
    </div>
  )
}
