import { useEffect, useState } from 'react'

/** `value`, but only after it has stopped changing for `delayMs`. Used so a
 * search box does not fire a request per keystroke (the Test Repository fans
 * out one request per project, so a fast typist used to send dozens). The
 * input itself should keep using the live value so typing stays responsive. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}
