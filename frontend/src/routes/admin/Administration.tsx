import { useState } from 'react'

import { cn } from '@/lib/utils'
import { AuditLogs } from './AuditLogs'
import { UsersRoles } from './UsersRoles'

const TABS = [
  { key: 'users', label: 'Users & Roles' },
  { key: 'audit', label: 'Audit Logs' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function Administration() {
  const [tab, setTab] = useState<TabKey>('users')

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Administration</h1>

      <div className="flex gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              tab === t.key
                ? 'border-[var(--primary)] font-medium text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' ? <UsersRoles /> : <AuditLogs />}
    </div>
  )
}
