import { ApiError } from '@/api/client'

// ADR-105: helpers for table bulk actions. Actions without a bulk endpoint run
// the existing per-item endpoint with limited concurrency and report per item.

export const MAX_BULK_SELECTION = 100
export const BULK_CONCURRENCY = 3

export interface BulkItemOutcome {
  id: string
  ok: boolean
  error: string | null
}

/** A human reason for one failed item; access-rule blocks name the rule's reason. */
export function failureReason(err: unknown): string {
  if (err instanceof ApiError) {
    return err.code === 'blocked_by_access_rule' ? `Blocked by access rule: ${err.message}` : err.message
  }
  return err instanceof Error ? err.message : 'Failed'
}

/** Run `worker` over `ids`, at most `concurrency` at a time; never rejects. */
export async function runLimited(
  ids: string[],
  worker: (id: string) => Promise<unknown>,
  concurrency = BULK_CONCURRENCY,
): Promise<BulkItemOutcome[]> {
  const outcomes: BulkItemOutcome[] = new Array(ids.length)
  let next = 0
  async function lane() {
    while (next < ids.length) {
      const index = next++
      try {
        await worker(ids[index])
        outcomes[index] = { id: ids[index], ok: true, error: null }
      } catch (err) {
        outcomes[index] = { id: ids[index], ok: false, error: failureReason(err) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, lane))
  return outcomes
}

/** '12 updated, 2 failed' plus the distinct failure reasons. */
export function summarizeOutcomes(outcomes: BulkItemOutcome[], verb = 'updated'): { message: string; failed: number } {
  const failed = outcomes.filter((o) => !o.ok)
  const ok = outcomes.length - failed.length
  const parts = [`${ok} ${verb}`]
  if (failed.length > 0) {
    const reasons = [...new Set(failed.map((o) => o.error ?? 'Failed'))].slice(0, 3).join('; ')
    parts.push(`${failed.length} failed (${reasons})`)
  }
  return { message: parts.join(', '), failed: failed.length }
}
