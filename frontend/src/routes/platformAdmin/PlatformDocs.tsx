import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  getPlatformDoc,
  getPlatformSession,
  listPlatformDocs,
  PLATFORM_SESSION_KEY,
  SESSION_IDLE_CODE,
} from '@/api/platformAdmin'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { DocsViewer } from '@/routes/docs/DocsViewer'

const BASE_PATH = '/platform-admin/docs'
const FETCHERS = { list: listPlatformDocs, get: getPlatformDoc }

function BackToConsole() {
  return (
    <Link to="/platform-admin" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      <ArrowLeft aria-hidden="true" className="size-4" /> Back to console
    </Link>
  )
}

/**
 * ADR-114: the full documentation (product, administration, engineering,
 * diagrams) lives only in the platform console, behind the platform session.
 * Tenant users have the User Guide instead.
 */
export function PlatformDocs() {
  // Same query (and cache) the console uses, so signing in there carries over.
  const session = useQuery({
    queryKey: PLATFORM_SESSION_KEY,
    queryFn: () =>
      getPlatformSession().catch((err: unknown) => {
        if (err instanceof ApiError && (err.code === 'unauthorized' || err.code === SESSION_IDLE_CODE)) return null
        throw err
      }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  if (session.isLoading) {
    return (
      <main id="main-content" className="mx-auto flex max-w-7xl flex-col gap-4 p-4 md:p-6">
        <div role="status" aria-label="Checking your session" className="flex flex-col gap-3">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    )
  }
  if (session.isError) {
    return (
      <main id="main-content" className="mx-auto max-w-3xl p-4 md:p-6">
        <ErrorState message="Could not reach the server." error={session.error} onRetry={() => session.refetch()} />
      </main>
    )
  }
  if (session.data?.stage !== 'mfa_verified') {
    return (
      <main id="main-content" className="mx-auto max-w-3xl p-4 md:p-6">
        <EmptyState
          title="Sign in to read the documentation"
          description="The documentation is available to platform administrators only. Sign in to the platform console first."
          action={
            <Link to="/platform-admin" className={buttonVariants({ size: 'sm' })}>
              Go to platform sign-in
            </Link>
          }
        />
      </main>
    )
  }

  return (
    <main id="main-content" className="mx-auto flex max-w-7xl flex-col gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">
      <div className="brd-noprint">
        <BackToConsole />
      </div>
      <DocsViewer
        basePath={BASE_PATH}
        queryScope={`platform:${session.data.email}`}
        fetchers={FETCHERS}
        readerLabel={`Reading as ${session.data.email} · Platform administrator`}
      />
    </main>
  )
}
