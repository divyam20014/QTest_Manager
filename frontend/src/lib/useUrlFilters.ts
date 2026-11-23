import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Pass C (deferred item #3, bug #13): syncs a flat set of string filter
 * values to the URL's query string, so a filtered list view is shareable
 * and survives a refresh. `defaults` are values that don't need to appear
 * in the URL at all (e.g. page=1, sort='created_at') -- setting a filter
 * back to its default removes that param rather than writing it
 * explicitly, keeping URLs clean.
 */
/** How long an update stays authoritative if the router never renders it (a superseded navigation). */
const PENDING_MS = 1500

export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams()
  // react-router hands a functional update the params of the LAST RENDER, not of the latest pending
  // navigation, so two updates before a re-render (a fast second click, a slow machine) would build
  // on stale params and bring back a filter the first one removed. `pending` carries the params of
  // the last update until the router has rendered them.
  const pending = useRef<{ params: URLSearchParams; at: number } | null>(null)
  useEffect(() => {
    // Forget it once the router has rendered it (an unrelated re-render with the old params must not).
    if (pending.current && pending.current.params.toString() === searchParams.toString()) pending.current = null
  }, [searchParams])

  const values = useMemo(() => {
    const out = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const raw = searchParams.get(key as string)
      if (raw !== null) out[key] = raw as T[keyof T]
    }
    return out
  }, [searchParams, defaults])

  // Setting more than one key at once (e.g. a filter change that also
  // resets `page` back to 1) must go through a single setSearchParams
  // call -- two separate calls in the same event handler each receive
  // their own snapshot of the search params and can clobber each other
  // instead of composing.
  const setFilters = useCallback(
    (patch: Partial<Record<keyof T, string>>) => {
      setSearchParams(
        (prev) => {
          const fresh = pending.current && Date.now() - pending.current.at < PENDING_MS ? pending.current.params : null
          const next = new URLSearchParams(fresh ?? prev)
          for (const key of Object.keys(patch) as (keyof T)[]) {
            const value = patch[key] as string
            if (value === '' || value === defaults[key]) {
              next.delete(key as string)
            } else {
              next.set(key as string, value)
            }
          }
          pending.current = { params: next, at: Date.now() }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams, defaults],
  )

  const setFilter = useCallback(
    (key: keyof T, value: string) => setFilters({ [key]: value } as Partial<Record<keyof T, string>>),
    [setFilters],
  )

  const clearAll = useCallback(() => {
    pending.current = null
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  // Active filters worth showing as removable chips -- excludes anything
  // currently at its default value.
  const active = (Object.keys(defaults) as (keyof T)[]).filter(
    (key) => values[key] !== defaults[key],
  )

  return { values, setFilter, setFilters, clearAll, active }
}
