import { apiFetch } from '@/api/client'

export type ViewListKey = 'test_cases' | 'defects' | 'test_runs'

export interface SavedView {
  id: string
  list_key: ViewListKey
  name: string
  filters: Record<string, string>
  sort: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export function listSavedViews(listKey: ViewListKey): Promise<SavedView[]> {
  return apiFetch<SavedView[]>(`/saved-views?list_key=${listKey}`)
}

export function createSavedView(req: {
  list_key: ViewListKey
  name: string
  filters: Record<string, string>
  sort?: string | null
  is_default?: boolean
}): Promise<SavedView> {
  return apiFetch<SavedView>('/saved-views', { method: 'POST', body: JSON.stringify(req) })
}

export function updateSavedView(
  id: string,
  req: Partial<{ name: string; filters: Record<string, string>; sort: string | null; is_default: boolean }>,
): Promise<SavedView> {
  return apiFetch<SavedView>(`/saved-views/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

export function deleteSavedView(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch<{ id: string; deleted: boolean }>(`/saved-views/${id}`, { method: 'DELETE' })
}
