import { ApiError } from '@/api/client'
import { createSavedView } from '@/api/savedViews'

/**
 * ADR-132: this page used to keep "saved filters" in the browser. Each user gets a copy of them
 * as saved views, once. The browser's originals are left untouched, so nothing can be lost, and
 * another person using the same browser gets their own copy.
 */
export const OLD_SAVED_FILTERS_KEY = 'qtesthub:table-filters:test-repository'
const FILTER_KEYS = ['search', 'status', 'priority', 'projectId', 'showDeprecated', 'assignee'] as const

const copiedKey = (userId: string) => `${OLD_SAVED_FILTERS_KEY}:copied:${userId}`

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Only the filters that were set, as saved views store them. */
function viewFilters(saved: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!saved || typeof saved !== 'object') return out
  for (const key of FILTER_KEYS) {
    const value = (saved as Record<string, unknown>)[key]
    if (typeof value !== 'string' || !value) continue
    if (key === 'showDeprecated' && value !== 'true') continue
    out[key] = value
  }
  return out
}

// One run at a time per user, so a page mounted twice cannot copy in parallel.
const running = new Map<string, Promise<number>>()

async function copy(userId: string): Promise<number> {
  const old = readJson(OLD_SAVED_FILTERS_KEY)
  if (!old || typeof old !== 'object' || Array.isArray(old)) return 0
  const stored = readJson(copiedKey(userId))
  // By name, so a view the user later deletes is not brought back by a retry of the others.
  const done = new Set<string>(Array.isArray(stored) ? stored.filter((n) => typeof n === 'string') : [])
  let created = 0
  for (const [name, saved] of Object.entries(old)) {
    if (done.has(name) || !name.trim()) continue
    try {
      await createSavedView({
        list_key: 'test_repository',
        name: name.trim().slice(0, 60),
        filters: viewFilters(saved),
        sort: null,
      })
      created += 1
    } catch (err) {
      // A view of that name already exists: nothing left to copy. Anything else is tried again
      // on the next visit.
      if (!(err instanceof ApiError && /already have a view/i.test(err.message))) continue
    }
    done.add(name)
    try {
      localStorage.setItem(copiedKey(userId), JSON.stringify([...done]))
    } catch {
      return created
    }
  }
  return created
}

/** Returns how many views were created. */
export function copySavedFilters(userId: string): Promise<number> {
  let run = running.get(userId)
  if (!run) {
    run = copy(userId).finally(() => running.delete(userId))
    running.set(userId, run)
  }
  return run
}
