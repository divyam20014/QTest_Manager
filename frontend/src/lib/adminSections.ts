import { KeyRound, Layers, LayoutPanelLeft, ListChecks, ScrollText, Settings as SettingsIcon, Users } from 'lucide-react'
import type { ComponentType } from 'react'

import type { MeResponse } from '@/api/auth'

import { canAccessPath } from './routeAccess'

// ADR-112: the admin area's sections, shared by the sidebar's single "Admin"
// item, the AdminLayout left sub-nav and the breadcrumbs. Visibility comes from
// canAccessPath (lib/routeAccess.ts), so nothing here widens access. Settings
// lives at /settings (not under /admin) and stays there; it is a section of
// the area, not a moved route.
export interface AdminSection {
  /** Canonical route (first of `paths`). */
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Every route that belongs to the section; the link goes to the first one the user may open. */
  paths: string[]
  group: string
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { to: '/admin/users', label: 'Users & Roles', icon: Users, paths: ['/admin/users'], group: 'People & access' },
  {
    to: '/admin/roles',
    label: 'Access Control',
    icon: KeyRound,
    paths: ['/admin/roles', '/admin/access-rules'],
    group: 'People & access',
  },
  { to: '/admin/environments', label: 'Environments', icon: Layers, paths: ['/admin/environments'], group: 'Workspace' },
  {
    to: '/admin/task-statuses',
    label: 'Task Statuses',
    icon: ListChecks,
    paths: ['/admin/task-statuses'],
    group: 'Workspace',
  },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, paths: ['/settings'], group: 'Workspace' },
  {
    to: '/admin/workspace',
    label: 'Workspace',
    icon: LayoutPanelLeft,
    paths: ['/admin/workspace'],
    group: 'Workspace',
  },
  { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText, paths: ['/admin/audit-logs'], group: 'Compliance' },
]

export interface VisibleAdminSection extends AdminSection {
  /** Where the link goes for this user. */
  target: string
}

export function sectionContains(section: AdminSection, pathname: string): boolean {
  return section.paths.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** The sections this user may open, in display order. */
export function visibleAdminSections(user: MeResponse | null): VisibleAdminSection[] {
  if (!user) return []
  return ADMIN_SECTIONS.flatMap((s) => {
    const target = s.paths.find((p) => canAccessPath(user, p))
    return target ? [{ ...s, target }] : []
  })
}

/** The section a path belongs to, or null outside the admin area. */
export function activeAdminSection(pathname: string): AdminSection | null {
  return ADMIN_SECTIONS.find((s) => sectionContains(s, pathname)) ?? null
}
