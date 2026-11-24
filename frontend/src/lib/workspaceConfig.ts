import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getWorkspaceConfig, type WorkspaceConfig, type WorkspaceViewMode } from '@/api/workspace'
import type { NavConfig } from '@/api/projects'
import { VIEW_MODES, type ViewMode } from '@/lib/viewMode'

/**
 * Tenant workspace defaults (ADR-125). The shell reads them once (cached query) and applies them
 * in the sidebar, the phone More sheet, the command palette, the project tab strip and the list
 * view switches. Every consumer falls back to the built-in defaults while the request is loading,
 * when it fails and when nothing is stored, so a slow or broken request can never empty a menu.
 * Hiding is cosmetic only: routes and permissions are untouched.
 */

/** The modes each list really offers (mirrors VIEW_MODE_LISTS on the API). */
export const LIST_VIEW_MODES: Record<string, readonly ViewMode[]> = {
  defects: ['list', 'board'],
  test_cases: ['list', 'board'],
  test_runs: ['list', 'board', 'calendar'],
}

export const LIST_VIEW_LABELS: Record<string, string> = {
  defects: 'Defects',
  test_cases: 'Test cases',
  test_runs: 'Test runs',
}

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  sidebar: { order: [], hidden: [] },
  project_tabs: { order: [], hidden: [] },
  view_modes: {},
}

export const WORKSPACE_QUERY_KEY = ['workspace-config'] as const

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** Defensive read of whatever the API returned (a missing or odd section means "defaults"). */
export function normalizeWorkspaceConfig(raw: unknown): WorkspaceConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_WORKSPACE_CONFIG
  const r = raw as Record<string, unknown>
  const section = (v: unknown) => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    return { order: strings(o.order), hidden: strings(o.hidden) }
  }
  const view_modes: Record<string, WorkspaceViewMode[]> = {}
  if (r.view_modes && typeof r.view_modes === 'object') {
    for (const [key, value] of Object.entries(r.view_modes as Record<string, unknown>)) {
      if (!LIST_VIEW_MODES[key]) continue
      const modes = strings(value).filter((m): m is WorkspaceViewMode => (VIEW_MODES as string[]).includes(m))
      view_modes[key] = modes
    }
  }
  return { sidebar: section(r.sidebar), project_tabs: section(r.project_tabs), view_modes }
}

/** The cached workspace defaults; `config` is the built-in defaults until (and unless) they load. */
export function useWorkspaceConfig(): { config: WorkspaceConfig; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: getWorkspaceConfig,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const config = useMemo(
    () => (query.data ? normalizeWorkspaceConfig(query.data) : DEFAULT_WORKSPACE_CONFIG),
    [query.data],
  )
  return { config, isLoading: query.isLoading, isError: query.isError }
}

/**
 * The modes a list offers: the built-in modes narrowed by the tenant default. "list" is always
 * kept, the built-in order is preserved and a mode the list does not support is ignored.
 */
export function availableModes(
  config: WorkspaceConfig,
  listKey: string,
  builtIn: readonly ViewMode[],
): readonly ViewMode[] {
  const chosen = config.view_modes[listKey]
  if (!chosen || chosen.length === 0) return builtIn
  const result = builtIn.filter((m) => m === 'list' || chosen.includes(m))
  return result.length === builtIn.length ? builtIn : result
}

/** `availableModes` for a list page; the returned array is stable between renders. */
export function useListModes(listKey: string, builtIn: readonly ViewMode[]): readonly ViewMode[] {
  const { config } = useWorkspaceConfig()
  const modes = availableModes(config, listKey, builtIn)
  const key = modes.join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => modes, [key, builtIn])
}

/** A project's own tab configuration wins; a project without one follows the tenant default. */
export function effectiveNavConfig(projectConfig: NavConfig | null | undefined, config: WorkspaceConfig): NavConfig {
  return projectConfig ?? config.project_tabs
}
