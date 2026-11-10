// Shared shape for the per-entity activity timeline (PV-9.3), returned by
// /test-cases/{id}/history, /requirements/{id}/history, and
// /defects/{id}/history (the latter predates this file and keeps its own
// identically-shaped DefectHistoryEntry in api/defects.ts).
export interface HistoryEntry {
  id: string
  action: string
  user_id: string | null
  user_name: string | null
  event_metadata: Record<string, unknown>
  created_at: string
}
