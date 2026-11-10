import { apiFetch } from '@/api/client'

export interface TestModule {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  test_case_count: number
  created_at: string
}

export function listModules(projectId: string): Promise<TestModule[]> {
  return apiFetch<TestModule[]>(`/projects/${projectId}/modules`)
}

export function createModule(
  projectId: string,
  req: { name: string; parent_id?: string | null },
): Promise<TestModule> {
  return apiFetch<TestModule>(`/projects/${projectId}/modules`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updateModule(
  moduleId: string,
  req: { name?: string; parent_id?: string | null },
): Promise<TestModule> {
  return apiFetch<TestModule>(`/modules/${moduleId}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })
}

export function deleteModule(moduleId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/modules/${moduleId}`, { method: 'DELETE' })
}
