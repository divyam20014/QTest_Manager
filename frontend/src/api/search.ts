import { apiFetch } from '@/api/client'

export type SearchResultType = 'test_case' | 'defect' | 'requirement'

export interface SearchResultEntry {
  type: SearchResultType
  id: string
  title: string
  project_id: string
  project_name: string
}

export interface SearchResponse {
  query: string
  results: SearchResultEntry[]
}

export function search(query: string): Promise<SearchResponse> {
  return apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(query)}`)
}
