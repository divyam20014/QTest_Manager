import { apiFetch } from '@/api/client'

export interface TestDataSetRow {
  id: string
  test_data_set_id: string
  name: string
  data: Record<string, unknown>
  created_at: string
}

export interface TestDataSet {
  id: string
  test_case_id: string
  name: string
  created_at: string
  rows: TestDataSetRow[]
}

export function listDataSets(testCaseId: string): Promise<TestDataSet[]> {
  return apiFetch<TestDataSet[]>(`/test-cases/${testCaseId}/data-sets`)
}

export function createDataSet(testCaseId: string, name: string): Promise<TestDataSet> {
  return apiFetch<TestDataSet>(`/test-cases/${testCaseId}/data-sets`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function deleteDataSet(dataSetId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/data-sets/${dataSetId}`, { method: 'DELETE' })
}

export function addDataSetRow(
  dataSetId: string,
  name: string,
  data: Record<string, unknown>,
): Promise<TestDataSet> {
  return apiFetch<TestDataSet>(`/data-sets/${dataSetId}/rows`, {
    method: 'POST',
    body: JSON.stringify({ name, data }),
  })
}

export function deleteDataSetRow(rowId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/data-set-rows/${rowId}`, { method: 'DELETE' })
}
