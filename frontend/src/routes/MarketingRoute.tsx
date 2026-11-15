import { lazy, Suspense } from 'react'

const MarketingSite = lazy(() => import('@/routes/marketing/MarketingSite'))

export function MarketingRoute() {
  return (
    <Suspense fallback={<div className="min-h-svh bg-[#101828]" />}>
      <MarketingSite />
    </Suspense>
  )
}
