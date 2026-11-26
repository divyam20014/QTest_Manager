import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The standard top-of-page block for every signed-in screen: one <h1>, an
 * optional one-line description, optional meta (badges/status next to the
 * title) and an actions area. The breadcrumb trail lives in the AppShell
 * header, so it is deliberately not repeated here.
 *
 * Rules (docs/DESIGN_SYSTEM.md): exactly one primary action, rightmost;
 * secondary actions to its left; on phones the actions wrap below the title.
 * `back` is the "← Parent" link shown above the title on detail screens;
 * `actionsClassName` lets a screen switch the actions to a grid on phones.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  back,
  actionsClassName,
  className,
  compactOnPhone,
}: {
  title: ReactNode
  description?: ReactNode
  /** Badges / status shown beside the title. */
  meta?: ReactNode
  /** Buttons / links, secondary first, primary last. */
  actions?: ReactNode
  /** "← Parent" link rendered above the title (detail screens). */
  back?: ReactNode
  /** Extra classes for the actions wrapper (e.g. a phone grid). */
  actionsClassName?: string
  className?: string
  /** Lists: leave out the back link and description on phones, so the first row starts higher. */
  compactOnPhone?: boolean
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {back && (compactOnPhone ? <div className="max-md:hidden">{back}</div> : back)}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="qth-type-page-title min-w-0 break-words">{title}</h1>
          {meta}
        </div>
        {description && <p className={cn('qth-type-helper max-w-prose', compactOnPhone && 'max-md:hidden')}>{description}</p>}
      </div>
      {actions && (
        <div className={cn('flex flex-wrap items-center gap-2 max-md:w-full', actionsClassName)}>{actions}</div>
      )}
    </div>
  )
}
