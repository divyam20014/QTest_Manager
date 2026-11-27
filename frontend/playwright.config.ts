import { defineConfig } from '@playwright/test'

import { WEB_URL, assertIsolatedTarget } from './e2e/target'

// ADR-134: refuses to load unless pointed at the throwaway stack of scripts/run_e2e.py.
assertIsolatedTarget()

export default defineConfig({
  testDir: './e2e',
  // Several journeys sign in more than once and the dev server compiles pages on first use, so the
  // 30 s default is too tight on a slow machine; a test that needs more sets its own.
  timeout: 60_000,
  // One at a time: the specs share one platform admin, whose codes cannot be reused.
  workers: 1,
  // No webServer here: reusing whatever already answers on a port is how tests reach the
  // wrong app. scripts/run_e2e.py starts its own servers on ports it first checks are free.
  use: {
    baseURL: WEB_URL,
  },
})
