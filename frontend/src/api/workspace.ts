import { apiFetch } from '@/api/client'

/** ADR-125: the tenant's workspace defaults. Mirrors `app/schemas/workspace.py`. */
export type WorkspaceViewMode = 'list' | 'board' | 'calendar'

export interface WorkspaceConfig {
  /** Top-level sidebar entries: saved order and hidden ids (core entries can never be hidden). */
  sidebar: { order: string[]; hidden: string[] }
  /** Default project tabs, used by every project that has no tab configuration of its own. */
  project_tabs: { order: string[]; hidden: string[] }
  /** List key -> the modes offered; a list that is absent keeps every built-in mode. */
  view_modes: Record<string, WorkspaceViewMode[]>
}

/** Readable by every signed-in user (the shell needs it). */
export function getWorkspaceConfig(): Promise<WorkspaceConfig> {
  return apiFetch<WorkspaceConfig>('/settings/workspace')
}

/** Replaces the whole document; an empty one stores nothing (the built-in defaults). Needs tenant.settings.manage. */
export function putWorkspaceConfig(config: WorkspaceConfig): Promise<WorkspaceConfig> {
  return apiFetch<WorkspaceConfig>('/settings/workspace', { method: 'PUT', body: JSON.stringify(config) })
}
