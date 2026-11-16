import { ShieldAlert } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

function roleLabel(role: string | undefined): string {
  if (!role) return ''
  return role.charAt(0).toUpperCase() + role.slice(1)
}

/**
 * "You don't have access to this page" -- shown instead of a screen the
 * signed-in user's role may not open, either up front (the route gate, before
 * any data request fires) or after the API answered 403 (see `ErrorState`).
 *
 * It says what happened and who to ask, names the current role, and gives two
 * ways out. It deliberately does not say which permission is missing: that is
 * detail an unauthorised user has no use for.
 *
 * `page` renders the standalone, `<h1>` version; `inline` is the compact block
 * used inside a screen that already has its own heading.
 */
export function NoAccess({ variant = 'page' }: { variant?: 'page' | 'inline' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const role = roleLabel(user?.role)
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  const body = (
    <>
      <span className="flex size-12 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </span>
      {variant === 'page' ? (
        <h1 className="qth-type-page-title">You don&apos;t have access to this page</h1>
      ) : (
        <p className="text-sm font-medium">You don&apos;t have access to this</p>
      )}
      <p className="max-w-md text-sm text-[var(--muted-foreground)]">
        {role ? `Your role (${role}) doesn't include permission to open this. ` : ''}
        If you need it, ask an administrator of your organization to update your access.
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {canGoBack && (
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Go back
          </Button>
        )}
        <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}>
          Back to Dashboard
        </Link>
      </div>
    </>
  )

  if (variant === 'inline') {
    return (
      <div role="status" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        {body}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-16 text-center" data-testid="no-access">
      {body}
    </div>
  )
}
