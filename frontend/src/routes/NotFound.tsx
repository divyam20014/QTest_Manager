import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'

// Bug #1 from the UI/UX review: unknown URLs silently fell through to the
// Dashboard via the old catch-all `<Route path="*" element={<Navigate to="/" />} />`,
// giving no sign anything was wrong. A real 404 screen instead.
export function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-[var(--link)]">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
        The page you're looking for doesn't exist, or you may not have access to it.
      </p>
      <Link to="/" className={buttonVariants()}>
        Back to Dashboard
      </Link>
    </div>
  )
}
