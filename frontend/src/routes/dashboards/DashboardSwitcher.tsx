import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

import { listDashboards } from '@/api/dashboards'
import { buttonVariants } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'

// One sidebar entry ("Dashboard"): this switcher moves between the built-in
// Overview (/) and the user's custom dashboards (ADR-099).
export function DashboardSwitcher({ currentId }: { currentId?: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const list = useQuery({
    queryKey: ['dashboards', 'list', user?.user_id],
    queryFn: listDashboards,
    retry: 1,
    staleTime: 30_000,
  })
  const items = list.data ?? []
  const missing = currentId && !items.some((d) => d.id === currentId)
  return (
    <div className="flex items-center gap-2 max-md:w-full">
      <label htmlFor="dashboard-view" className="text-sm text-[var(--muted-foreground)]">
        View
      </label>
      <Select
        id="dashboard-view"
        className="w-52 max-md:flex-1"
        value={currentId ?? ''}
        onChange={(e) => navigate(e.target.value ? `/dashboards/${e.target.value}` : '/')}
      >
        <option value="">Overview</option>
        {items.map((d) => (
          <option key={d.id} value={d.id}>
            {d.is_team_default ? `${d.name} (team)` : d.name}
          </option>
        ))}
        {missing && <option value={currentId}>Current dashboard</option>}
      </Select>
      <Link
        to="/dashboards"
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        Customise
      </Link>
    </div>
  )
}
