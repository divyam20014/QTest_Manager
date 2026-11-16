import { type ComponentType, lazy } from 'react'

const RELOAD_KEY = 'qtesthub:chunk-reload'

/** `React.lazy` for a named export, with one automatic reload when the chunk
 * 404s (stale hashed filename after a deploy). The sessionStorage flag stops
 * a reload loop; storage failures are tolerated. */
export function lazyRoute<K extends string, T extends ComponentType>(
  load: () => Promise<Record<K, T>>,
  name: K,
) {
  return lazy(async () => {
    try {
      const mod = await load()
      try {
        sessionStorage.removeItem(RELOAD_KEY)
      } catch {
        // ignore
      }
      return { default: mod[name] }
    } catch (error) {
      let alreadyReloaded = false
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1'
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, '1')
      } catch {
        alreadyReloaded = true
      }
      if (!alreadyReloaded) {
        window.location.reload()
        return new Promise<never>(() => {})
      }
      throw error
    }
  })
}
