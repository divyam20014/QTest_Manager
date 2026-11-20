import { useQuery } from '@tanstack/react-query'
import { Snowflake } from 'lucide-react'
import { useLocation } from 'react-router-dom'

import { listActiveAccessRules } from '@/api/accessRules'
import { formatRuleInstant } from '@/lib/accessRuleTime'

/**
 * RBAC Phase 4 (ADR-092): tells a user, before they hit a refusal, that a
 * release freeze or environment restriction currently applies to their role.
 * The API returns only the rules that restrict this user right now (an Admin,
 * or a tenant with no rules, gets an empty list), so nothing renders by
 * default. A project-scoped rule shows only on that project's pages.
 */
export function AccessRuleBanner() {
  const { pathname } = useLocation()
  const query = useQuery({
    queryKey: ['access-rules', 'active'],
    queryFn: listActiveAccessRules,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  })

  const visible = (query.data ?? []).filter(
    (rule) =>
      rule.rule_type === 'freeze_window' &&
      (rule.project_id === null || pathname.includes(`/projects/${rule.project_id}`)),
  )
  if (visible.length === 0) return null

  return (
    <div className="mb-4 flex flex-col gap-2" data-testid="access-rule-banner">
      {visible.map((rule) => (
        <div
          key={rule.id}
          role="status"
          className="flex items-start gap-3 rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm text-[var(--status-warning)]"
        >
          <Snowflake className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">Changes are restricted right now</p>
            <p className="break-words">{rule.reason}</p>
            {rule.ends_at && <p className="text-xs opacity-90">Until {formatRuleInstant(rule.ends_at)}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
