import { apiFetch } from '@/api/client'

export interface SharedStep {
  id: string
  project_id: string
  name: string
  action: string
  expected: string
  category: string | null
  created_at: string
}

export function listSharedSteps(projectId: string): Promise<SharedStep[]> {
  return apiFetch<SharedStep[]>(`/projects/${projectId}/shared-steps`)
}

export function createSharedStep(
  projectId: string,
  req: { name: string; action: string; expected: string; category?: string | null },
): Promise<SharedStep> {
  return apiFetch<SharedStep>(`/projects/${projectId}/shared-steps`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function updateSharedStep(
  sharedStepId: string,
  req: { name?: string; action?: string; expected?: string; category?: string | null },
): Promise<SharedStep> {
  return apiFetch<SharedStep>(`/shared-steps/${sharedStepId}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })
}

export function deleteSharedStep(sharedStepId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/shared-steps/${sharedStepId}`, { method: 'DELETE' })
}
