import { apiFetch } from '@/api/client'

export interface Template {
  id: string
  category: string
  title: string
  description: string
  priority: string
}

export interface TemplateImportResult {
  imported_test_case_ids: string[]
  modules_created: string[]
}

export function listTemplates(): Promise<Template[]> {
  return apiFetch<Template[]>('/templates')
}

export function importTemplates(
  projectId: string,
  templateIds: string[],
): Promise<TemplateImportResult> {
  return apiFetch<TemplateImportResult>(`/projects/${projectId}/templates/import`, {
    method: 'POST',
    body: JSON.stringify({ template_ids: templateIds }),
  })
}
