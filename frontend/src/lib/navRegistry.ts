import {
  BarChart3,
  BookOpen,
  Bug,
  Building2,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  ListChecks,
  UserCircle,
  UserCog,
} from 'lucide-react'
import type { ComponentType } from 'react'

import type { MeResponse } from '@/api/auth'
import { ADMIN_SECTIONS } from '@/lib/adminSections'
import { canAccessPath } from '@/lib/routeAccess'

/**
 * The sidebar's single definition (ADR-121, flattened by ADR-130): one ordered list of links.
 * The desktop sidebar, the phone "More" sheet and the command palette all read it, so a
 * destination is added or hidden in one place.
 *
 * Rules:
 *  - An entry needs a real page behind it. Calendar, Documents and Test Automation have
 *    none today, so they are not listed; do not add a placeholder.
 *  - Who sees what is not stored here. `lib/routeAccess.ts` decides (the same function
 *    the route gate uses), so the menu and the URL can never disagree.
 *  - A page reached from another page (the Execution Console from Test Runs, the
 *    compliance report from Reports) belongs to that entry's `paths`, so it stays lit.
 */

type Icon = ComponentType<{ className?: string }>

export type BadgeKey = 'defects' | 'myWork'

export interface NavLeaf {
  /** Stable id (data-testid, storage keys, tests, the workspace defaults). */
  id: string
  to: string
  label: string
  icon: Icon
  /** Active only on exactly `to` (the dashboard). */
  end?: boolean
  /**
   * One item covering several routes (`to` is the default target). It shows if any is
   * reachable, links to the first that is, and is active on all of them.
   */
  paths?: string[]
  /** Count shown as a badge; the shell computes it from real data. */
  badge?: BadgeKey
}

export const NAV_REGISTRY: NavLeaf[] = [
  { id: 'home', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { id: 'my-work', to: '/my-work', label: 'My Work', icon: ListChecks, badge: 'myWork' },
  { id: 'projects', to: '/projects', label: 'Projects', icon: Building2 },
  { id: 'test-cases', to: '/test-repository', label: 'Test Cases', icon: FileStack, paths: ['/test-repository', '/test-cases'] },
  {
    id: 'test-runs',
    to: '/test-runs',
    label: 'Test Runs',
    icon: ClipboardList,
    paths: ['/test-runs', '/execution', '/test-run-cases'],
  },
  { id: 'defects', to: '/defects', label: 'Defects', icon: Bug, badge: 'defects' },
  // Someone who may only export the compliance report still gets a link to it.
  { id: 'reports', to: '/reporting', label: 'Reports', icon: BarChart3, paths: ['/reporting', '/reporting/print'] },
  {
    // One entry for the whole area: it links to the first admin page this user may open and
    // is active on all of them. AdminLayout's sub-nav lists the sections.
    id: 'admin',
    to: '/admin/users',
    label: 'Admin',
    icon: UserCog,
    paths: ADMIN_SECTIONS.flatMap((s) => s.paths),
  },
]

/** The User Guide is a pinned footer link above Profile (ADR-114); open to every signed-in user. */
export const USER_GUIDE_ITEM: NavLeaf = { id: 'user-guide', to: '/user-guide', label: 'User Guide', icon: BookOpen }
export const PROFILE_ITEM: NavLeaf = { id: 'profile', to: '/account', label: 'Profile', icon: UserCircle }

/** Destinations kept out of the sidebar but still offered by the command palette. */
export const PALETTE_EXTRA_ENTRIES: { label: string; sublabel: string; path: string }[] = [
  { label: 'Execution Console', sublabel: 'Test Runs', path: '/execution' },
  { label: 'Compliance report', sublabel: 'Reports', path: '/reporting/print' },
  { label: 'Report builder', sublabel: 'Analytics', path: '/reporting/builder' },
  { label: 'User Guide', sublabel: 'Help', path: '/user-guide' },
  { label: 'Users & Roles', sublabel: 'Administration', path: '/admin/users' },
  { label: 'Teams', sublabel: 'Administration', path: '/admin/teams' },
  { label: 'Roles & Permissions', sublabel: 'Administration', path: '/admin/roles' },
  { label: 'Access Rules', sublabel: 'Administration', path: '/admin/access-rules' },
  { label: 'Audit Logs', sublabel: 'Administration', path: '/admin/audit-logs' },
  { label: 'Environments', sublabel: 'Administration', path: '/admin/environments' },
  { label: 'Task Statuses', sublabel: 'Administration', path: '/admin/task-statuses' },
  { label: 'Settings', sublabel: 'Administration', path: '/settings' },
]

// ---- tenant defaults (ADR-125) --------------------------------------------------------

/** Entries every role needs to get around: reorderable, never hidden (the API enforces it too). */
export const CORE_NAV_ENTRY_IDS: readonly string[] = ['home', 'projects', 'my-work', 'admin']

export interface NavEntryMeta {
  id: string
  label: string
  core: boolean
}

/** What the Workspace settings page lists, in the built-in order. */
export const NAV_ENTRY_META: NavEntryMeta[] = NAV_REGISTRY.map(({ id, label }) => ({
  id,
  label,
  core: CORE_NAV_ENTRY_IDS.includes(id),
}))

/** The saved order first (unknown ids dropped), then every entry it does not mention in built-in order. */
export function fullNavOrder(saved: readonly string[] | undefined): string[] {
  const known = new Set(NAV_ENTRY_META.map((m) => m.id))
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of saved ?? []) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  for (const m of NAV_ENTRY_META) if (!seen.has(m.id)) out.push(m.id)
  return out
}

/** Hidden ids restricted to entries that may actually be hidden. */
export function hiddenNavIds(saved: readonly string[] | undefined): Set<string> {
  const hideable = new Set(NAV_ENTRY_META.filter((m) => !m.core).map((m) => m.id))
  return new Set((saved ?? []).filter((id) => hideable.has(id)))
}

/** Apply the tenant's saved order and hidden entries to the registry (before access filtering). */
export function applyNavConfig(
  registry: NavLeaf[],
  config: { order: readonly string[]; hidden: readonly string[] } | undefined,
): NavLeaf[] {
  if (!config || (config.order.length === 0 && config.hidden.length === 0)) return registry
  const rank = new Map(fullNavOrder(config.order).map((id, i) => [id, i]))
  const hidden = hiddenNavIds(config.hidden)
  return registry
    .filter((e) => !hidden.has(e.id))
    .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
}

// ---- resolution (what this user sees) ----------------------------------------

/** The leaf as this user sees it (link target = first reachable route), or null. */
export function resolveLeaf(user: MeResponse | null, item: NavLeaf): NavLeaf | null {
  const target = (item.paths ?? [item.to]).find((p) => canAccessPath(user, p))
  return target ? { ...item, to: target } : null
}

/** Filter the registry by access. */
export function resolveRegistry(user: MeResponse | null, registry: NavLeaf[] = NAV_REGISTRY): NavLeaf[] {
  return registry.flatMap((item) => {
    const resolved = resolveLeaf(user, item)
    return resolved ? [resolved] : []
  })
}

function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(path + '/')
}

/** Whether `pathname` belongs to the leaf. */
export function isLeafActive(item: NavLeaf, pathname: string): boolean {
  if (item.paths) return item.paths.some((p) => matches(pathname, p))
  return item.end ? pathname === item.to : matches(pathname, item.to)
}

// ---- badges ---------------------------------------------------------------------

export interface BadgeCounts {
  defects: number
  myWork: number
}

const BADGE_NOUN: Record<BadgeKey, string> = { defects: 'open', myWork: 'pending' }

export function leafBadge(item: NavLeaf, counts: BadgeCounts): { count: number; noun: string } | null {
  if (!item.badge) return null
  return { count: counts[item.badge], noun: BADGE_NOUN[item.badge] }
}

// ---- consumers -----------------------------------------------------------------

/** Flat list for the command palette's "Navigate" group. */
export function paletteEntries(entries: NavLeaf[]): { label: string; sublabel: string; path: string }[] {
  return entries.map((i) => ({ label: i.label, sublabel: 'Workspace', path: i.to }))
}

export interface SheetItem {
  to: string
  label: string
  icon: Icon
  paths?: string[]
  count?: number
  countNoun?: string
}

export interface SheetSection {
  label: string
  items: SheetItem[]
}

/** The phone "More" sheet's section of workspace links. */
export function sheetSections(entries: NavLeaf[], counts: BadgeCounts): SheetSection[] {
  if (entries.length === 0) return []
  const items = entries.map((leaf): SheetItem => {
    const badge = leafBadge(leaf, counts)
    return {
      to: leaf.to,
      label: leaf.label,
      icon: leaf.icon,
      paths: leaf.paths,
      count: badge?.count,
      countNoun: badge?.noun,
    }
  })
  return [{ label: 'Workspace', items }]
}
