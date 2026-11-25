import {
  BarChart3,
  BookOpen,
  Bug,
  Building2,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  ListChecks,
  MonitorPlay,
  Play,
  ShieldCheck,
  UserCircle,
  UserCog,
} from 'lucide-react'
import type { ComponentType } from 'react'

import type { MeResponse } from '@/api/auth'
import { ADMIN_SECTIONS } from '@/lib/adminSections'
import { canAccessPath } from '@/lib/routeAccess'

/**
 * The sidebar's single definition (ADR-121): a data-driven registry of top-level links
 * and expandable groups. The desktop sidebar, the phone "More" sheet and the command
 * palette all read it, so a destination is added or hidden in one place.
 *
 * Rules:
 *  - An entry needs a real page behind it. Calendar, Documents and Test Automation have
 *    none today, so they are not listed; do not add a placeholder.
 *  - Who sees what is not stored here. `lib/routeAccess.ts` decides (the same function
 *    the route gate uses), so the menu and the URL can never disagree.
 *  - A group heading is a toggle, never a link. A group left with a single visible link
 *    renders as that plain link, so the sidebar never shows a one-item folder.
 */

type Icon = ComponentType<{ className?: string }>

export type BadgeKey = 'defects' | 'myWork'

export interface NavLeaf {
  /** Stable id (data-testid, storage keys, tests). */
  id: string
  to: string
  label: string
  icon: Icon
  /** Active only on exactly `to` (the dashboard). */
  end?: boolean
  /** The item leaves the shell (a print-optimised page): opens in a new tab and says so. */
  newTab?: boolean
  /**
   * One item covering several routes (`to` is the default target). It shows if any is
   * reachable, links to the first that is, and is active on all of them.
   */
  paths?: string[]
  /** Count shown as a badge; the shell computes it from real data. */
  badge?: BadgeKey
}

export interface NavGroup {
  id: string
  label: string
  icon: Icon
  items: NavLeaf[]
}

export type NavEntry = { kind: 'link'; item: NavLeaf } | { kind: 'group'; group: NavGroup }

export const NAV_REGISTRY: NavEntry[] = [
  { kind: 'link', item: { id: 'home', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true } },
  { kind: 'link', item: { id: 'projects', to: '/projects', label: 'Projects', icon: Building2 } },
  { kind: 'link', item: { id: 'my-work', to: '/my-work', label: 'My Work', icon: ListChecks, badge: 'myWork' } },
  {
    kind: 'group',
    group: {
      id: 'test-management',
      label: 'Test Management',
      icon: FileStack,
      items: [
        {
          id: 'test-cases',
          to: '/test-repository',
          label: 'Test Cases',
          icon: FileStack,
          paths: ['/test-repository', '/test-cases'],
        },
      ],
    },
  },
  {
    kind: 'group',
    group: {
      id: 'test-execution',
      label: 'Test Execution',
      icon: Play,
      items: [
        { id: 'test-runs', to: '/test-runs', label: 'Test Runs', icon: ClipboardList },
        {
          id: 'execution-console',
          to: '/execution',
          label: 'Execution Console',
          icon: MonitorPlay,
          paths: ['/execution', '/test-run-cases'],
        },
      ],
    },
  },
  { kind: 'link', item: { id: 'defects', to: '/defects', label: 'Defects', icon: Bug, badge: 'defects' } },
  {
    kind: 'group',
    group: {
      id: 'reports',
      label: 'Reports & Analytics',
      icon: BarChart3,
      items: [
        { id: 'reports', to: '/reporting', label: 'Reports', icon: BarChart3 },
        { id: 'compliance', to: '/reporting/print', label: 'Compliance Reports', icon: ShieldCheck, newTab: true },
      ],
    },
  },
  {
    // One entry for the whole area: it links to the first admin page this user may open and
    // is active on all of them. AdminLayout's sub-nav lists the sections.
    kind: 'link',
    item: {
      id: 'admin',
      to: '/admin/users',
      label: 'Admin',
      icon: UserCog,
      paths: ADMIN_SECTIONS.flatMap((s) => s.paths),
    },
  },
]

/** The User Guide is a pinned footer link above Profile (ADR-114); open to every signed-in user. */
export const USER_GUIDE_ITEM: NavLeaf = { id: 'user-guide', to: '/user-guide', label: 'User Guide', icon: BookOpen }
export const PROFILE_ITEM: NavLeaf = { id: 'profile', to: '/account', label: 'Profile', icon: UserCircle }

/** Destinations kept out of the sidebar but still offered by the command palette. */
export const PALETTE_EXTRA_ENTRIES: { label: string; sublabel: string; path: string }[] = [
  { label: 'Report builder', sublabel: 'Analytics', path: '/reporting/builder' },
  { label: 'User Guide', sublabel: 'Help', path: '/user-guide' },
  { label: 'Users & Roles', sublabel: 'Administration', path: '/admin/users' },
  { label: 'Roles & Permissions', sublabel: 'Administration', path: '/admin/roles' },
  { label: 'Access Rules', sublabel: 'Administration', path: '/admin/access-rules' },
  { label: 'Audit Logs', sublabel: 'Administration', path: '/admin/audit-logs' },
  { label: 'Environments', sublabel: 'Administration', path: '/admin/environments' },
  { label: 'Task Statuses', sublabel: 'Administration', path: '/admin/task-statuses' },
  { label: 'Settings', sublabel: 'Administration', path: '/settings' },
]

// ---- tenant defaults (ADR-125) --------------------------------------------------------

/** The id an admin orders / hides: a link's id or a group's id. */
export function navEntryId(entry: NavEntry): string {
  return entry.kind === 'link' ? entry.item.id : entry.group.id
}

/** Entries every role needs to get around: reorderable, never hidden (the API enforces it too). */
export const CORE_NAV_ENTRY_IDS: readonly string[] = ['home', 'projects', 'my-work', 'admin']

export interface NavEntryMeta {
  id: string
  label: string
  core: boolean
}

/** What the Workspace settings page lists, in the built-in order. */
export const NAV_ENTRY_META: NavEntryMeta[] = NAV_REGISTRY.map((entry) => {
  const id = navEntryId(entry)
  return { id, label: entry.kind === 'link' ? entry.item.label : entry.group.label, core: CORE_NAV_ENTRY_IDS.includes(id) }
})

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
  registry: NavEntry[],
  config: { order: readonly string[]; hidden: readonly string[] } | undefined,
): NavEntry[] {
  if (!config || (config.order.length === 0 && config.hidden.length === 0)) return registry
  const rank = new Map(fullNavOrder(config.order).map((id, i) => [id, i]))
  const hidden = hiddenNavIds(config.hidden)
  return registry
    .filter((e) => !hidden.has(navEntryId(e)))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (rank.get(navEntryId(a.e)) ?? 999) - (rank.get(navEntryId(b.e)) ?? 999) || a.i - b.i)
    .map(({ e }) => e)
}

// ---- resolution (what this user sees) ----------------------------------------

export type ResolvedEntry = { kind: 'link'; item: NavLeaf } | { kind: 'group'; group: NavGroup }

/** The leaf as this user sees it (link target = first reachable route), or null. */
export function resolveLeaf(user: MeResponse | null, item: NavLeaf): NavLeaf | null {
  const target = (item.paths ?? [item.to]).find((p) => canAccessPath(user, p))
  return target ? { ...item, to: target } : null
}

/**
 * Filter the registry by access. Groups with no visible leaf disappear; a group with
 * exactly one becomes that plain link.
 */
export function resolveRegistry(user: MeResponse | null, registry: NavEntry[] = NAV_REGISTRY): ResolvedEntry[] {
  const out: ResolvedEntry[] = []
  for (const entry of registry) {
    if (entry.kind === 'link') {
      const item = resolveLeaf(user, entry.item)
      if (item) out.push({ kind: 'link', item })
      continue
    }
    const items = entry.group.items.flatMap((leaf) => {
      const resolved = resolveLeaf(user, leaf)
      return resolved ? [resolved] : []
    })
    if (items.length === 0) continue
    if (items.length === 1) out.push({ kind: 'link', item: items[0] })
    else out.push({ kind: 'group', group: { ...entry.group, items } })
  }
  return out
}

function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(path + '/')
}

/** Whether `pathname` belongs to the leaf (new-tab items are never "current"). */
export function isLeafActive(item: NavLeaf, pathname: string): boolean {
  if (item.newTab) return false
  if (item.paths) return item.paths.some((p) => matches(pathname, p))
  return item.end ? pathname === item.to : matches(pathname, item.to)
}

export function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((i) => isLeafActive(i, pathname))
}

/** The id of the group holding the current route, if any (it auto-expands). */
export function activeGroupId(entries: ResolvedEntry[], pathname: string): string | null {
  for (const e of entries) if (e.kind === 'group' && isGroupActive(e.group, pathname)) return e.group.id
  return null
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
export function paletteEntries(entries: ResolvedEntry[]): { label: string; sublabel: string; path: string }[] {
  const out: { label: string; sublabel: string; path: string }[] = []
  for (const e of entries) {
    if (e.kind === 'link') out.push({ label: e.item.label, sublabel: 'Workspace', path: e.item.to })
    else for (const i of e.group.items) out.push({ label: i.label, sublabel: e.group.label, path: i.to })
  }
  return out
}

export interface SheetItem {
  to: string
  label: string
  icon: Icon
  newTab?: boolean
  paths?: string[]
  count?: number
  countNoun?: string
}

export interface SheetSection {
  label: string
  items: SheetItem[]
}

/** The phone "More" sheet's sections: top-level links first, then one section per group. */
export function sheetSections(entries: ResolvedEntry[], counts: BadgeCounts): SheetSection[] {
  const toSheet = (leaf: NavLeaf): SheetItem => {
    const badge = leafBadge(leaf, counts)
    return {
      to: leaf.to,
      label: leaf.label,
      icon: leaf.icon,
      newTab: leaf.newTab,
      paths: leaf.paths,
      count: badge?.count,
      countNoun: badge?.noun,
    }
  }
  const sections: SheetSection[] = []
  const top: SheetItem[] = []
  for (const e of entries) {
    if (e.kind === 'link') top.push(toSheet(e.item))
    else sections.push({ label: e.group.label, items: e.group.items.map(toSheet) })
  }
  return top.length > 0 ? [{ label: 'Workspace', items: top }, ...sections] : sections
}
