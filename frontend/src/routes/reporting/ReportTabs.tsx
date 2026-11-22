import { hasPermission } from '@/api/auth'
import { LinkTabs, type LinkTabItem } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth'

// ADR-108: the Report builder is reached from Reports (same tab-strip pattern
// as projects/ProjectTabs.tsx) instead of its own sidebar item. Compliance is
// the print-ready compliance report (it opens outside the app shell and is
// only offered to roles that can export it).
export function ReportTabs() {
  const { user } = useAuth()
  const items: LinkTabItem[] = [
    { label: 'Overview', to: '/reporting', end: true },
    ...(hasPermission(user, 'report.compliance_export')
      ? [{ label: 'Compliance', to: '/reporting/print', end: true }]
      : []),
    { label: 'Report builder', to: '/reporting/builder', end: true },
  ]
  return <LinkTabs items={items} label="Report sections" className="-mb-2" />
}
