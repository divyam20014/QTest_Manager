import { Outlet } from 'react-router-dom'

import { AdminSubNav } from '@/components/AdminSubNav'
import { useAuth } from '@/lib/auth'
import { visibleAdminSections } from '@/lib/adminSections'

/**
 * Layout route around every admin page (ADR-112). URLs are unchanged; the left
 * sub-nav lists only the sections the user may open (canAccessPath). A user who
 * can reach a single section gets the page without a lone-item nav.
 */
export function AdminLayout() {
  const { user } = useAuth()
  const sections = visibleAdminSections(user)
  if (sections.length < 2) return <Outlet />
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <AdminSubNav sections={sections} />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
