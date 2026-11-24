import { useMutation, useQuery } from '@tanstack/react-query'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { logout } from '@/api/auth'
import { getBranding, getLogoUrl } from '@/api/settings'
import { CommandPalette } from '@/components/CommandPalette'
import { RouteBoundary } from '@/components/RouteBoundary'
import { MobileTabBar, MoreSheet } from '@/components/MobileNav'
import { NoAccess } from '@/components/NoAccess'
import { AccessRuleBanner } from '@/components/AccessRuleBanner'
import { PIN_ICON } from '@/components/pinIcons'
import { SidebarLink, SidebarNav } from '@/components/SidebarNav'
import { TopBar } from '@/components/TopBar'
import { NAV_REGISTRY, PROFILE_ITEM, USER_GUIDE_ITEM, applyNavConfig, resolveRegistry, sheetSections } from '@/lib/navRegistry'
import { useWorkspaceConfig } from '@/lib/workspaceConfig'
import { canAccessPath } from '@/lib/routeAccess'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useFavourites } from '@/lib/useFavourites'
import { useBadgeAnnouncement, useNavBadges } from '@/lib/useNavBadges'
import { useRecents } from '@/lib/useRecents'

// The sidebar's destinations live in lib/navRegistry.ts (ADR-121). Which ones a role sees
// comes from lib/routeAccess.ts, shared with the route gate, so the menu and the URL can
// never disagree.

const COLLAPSE_STORAGE_KEY = 'qtesthub:sidebar-collapsed'

// SAAS-GAP-10/9: a per-viewer UI preference, not tenant data -- fine to
// keep in localStorage (per-device convenience, never a source of truth),
// wrapped defensively since private-browsing/blocked-storage contexts can
// throw on read or write.
function useCollapsedPreference(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  function update(value: boolean) {
    setCollapsed(value)
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, value ? '1' : '0')
    } catch {
      // Private browsing / blocked storage -- the toggle still works for
      // this page view, it just won't persist across reloads.
    }
  }

  return [collapsed, update]
}

export function AppShell() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useCollapsedPreference()
  const [moreOpen, setMoreOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Phase 2: Ctrl+K / Cmd+K opens the command palette from anywhere in
  // the authenticated shell -- the single global hotkey listener lives
  // here since AppShell wraps every authenticated route via <Outlet />.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
  // Tier 4 / ADR-054: tenant branding (PV-11.4). Any authenticated user
  // can read it (the shell needs it for everyone, not just admins).
  const brandingQuery = useQuery({ queryKey: ['branding'], queryFn: getBranding })
  const branding = brandingQuery.data

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await refresh()
      navigate('/login', { replace: true })
    },
  })

  const { config: workspace } = useWorkspaceConfig()
  const entries = useMemo(
    () => resolveRegistry(user, applyNavConfig(NAV_REGISTRY, workspace.sidebar)),
    [user, workspace.sidebar],
  )
  const { counts, ready } = useNavBadges()
  const announcement = useBadgeAnnouncement(counts, ready)
  const favourites = useFavourites()
  const recents = useRecents()

  // The phone More sheet: the same registry, plus Favourites and Recent when there are any.
  const sections = useMemo(() => {
    const pinned = (label: string, items: typeof favourites.items) =>
      items.length > 0
        ? [{ label, items: items.map((i) => ({ to: i.url, label: i.title, icon: PIN_ICON[i.type] })) }]
        : []
    return [
      ...sheetSections(entries, counts),
      ...pinned('Favourites', favourites.items),
      ...pinned('Recent', recents.items),
    ]
  }, [entries, counts, favourites.items, recents.items])

  return (
    <div className="flex min-h-svh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[var(--background)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--foreground)] focus:shadow-lg focus:ring-2 focus:ring-[var(--ring)]"
      >
        Skip to main content
      </a>
      <aside
        aria-label="Sidebar"
        className={cn(
          'qth-shell-chrome',
          // Mobile redesign Phase 1: below md the sidebar is replaced by the
          // bottom tab bar + More sheet (components/MobileNav.tsx).
          'hidden w-60 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-foreground)] md:static md:flex md:transition-[width] md:duration-200 motion-reduce:md:transition-none',
          collapsed ? 'md:w-16' : 'md:w-60',
        )}
        style={branding?.primary_color ? ({ '--sidebar-accent': branding.primary_color } as CSSProperties) : undefined}
      >
        <div className={cn('flex h-14 shrink-0 items-center gap-2 px-4', collapsed && 'justify-center px-0')}>
          {branding?.has_logo ? (
            <img
              src={getLogoUrl()}
              alt=""
              width={28}
              height={28}
              decoding="async"
              className="size-7 shrink-0 rounded-md object-contain"
            />
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--sidebar-accent)] text-sm font-bold text-[var(--sidebar-bg)]">
              Q
            </span>
          )}
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-wide text-white">
              {branding?.display_name || 'QTestHub'}
            </span>
          )}
        </div>

        <SidebarNav entries={entries} collapsed={collapsed} counts={counts} announcement={announcement} />

        <div className="flex flex-col gap-0.5 border-t border-[var(--sidebar-border)] px-3 py-3">
          {canAccessPath(user, USER_GUIDE_ITEM.to) && <SidebarLink item={USER_GUIDE_ITEM} collapsed={collapsed} />}
          <SidebarLink item={PROFILE_ITEM} collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed(!collapsed)}
          onOpenPalette={() => setPaletteOpen(true)}
          onLogout={() => logoutMutation.mutate()}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 bg-[var(--muted)]/40 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6"
        >
          <RouteBoundary resetKey={location.pathname}>
            <AccessRuleBanner />
            {/* Restricted screens are blocked here, before the route element
                renders, so a user who may not open one never downloads it or
                fires its data requests. The API still enforces access. */}
            {user && !canAccessPath(user, location.pathname) ? (
              <NoAccess />
            ) : (
              <>
                <Outlet />
              </>
            )}
          </RouteBoundary>
        </main>
      </div>
      <MobileTabBar moreOpen={moreOpen} onMore={() => setMoreOpen(true)} />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        sections={sections}
        userName={user?.name}
        userRole={user?.role}
        onSearch={() => setPaletteOpen(true)}
        onLogout={() => {
          setMoreOpen(false)
          logoutMutation.mutate()
        }}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
