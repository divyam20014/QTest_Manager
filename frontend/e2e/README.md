# Browser tests

These tests create tenants and platform admins, sign in with test passwords, enter wrong
codes on purpose and edit database rows. They run against a **throwaway stack of their own**,
never the development app (ADR-134).

## Running them

From `frontend/`, with the Postgres container running (`docker compose up -d db`):

```
npm run test:e2e                                  # everything (this takes hours)
npm run test:e2e -- e2e/smoke.spec.ts             # one file
npm run test:e2e -- -g "phone" --headed           # any Playwright option
```

`scripts/run_e2e.py` creates the database `qtesthub_e2e`, migrates it, adds the test
platform admin, starts an API on 8100, a background worker and a web server on 5175 from
your working tree, runs Playwright, then stops them and drops the database. Your app on
5173 / 8000 and the `qtesthub` database are not used, and it can stay running.

Needed once: the backend and frontend dependencies, and Playwright's browser
(`npx playwright install chromium`). Server logs are kept in a temporary folder whose path
is printed.

## Why `npx playwright test` stops with an error

That is the safety check in `target.ts`. Playwright only runs when the runner above has
started the stack, and never against ports 5173 or 8000, a database that is not a
`qtesthub_e2e*` / `qtesthub_audit*` one, or another computer. There is no switch to turn
this off. For the same reason there is no `webServer` in `playwright.config.ts`: reusing
whatever answers on a port is how tests end up in the wrong app.

## Writing a test

Take addresses from the code, never type them:

| Need | Use |
| --- | --- |
| API address | `API_BASE_URL` from `./fixtures` |
| Web address | `WEB_URL`, `LOOPBACK_WEB_URL` from `./target` |
| Database name | `DB_NAME` from `./target` |

The runner refuses to start if a test file names the development ports or database.

## Database passwords

Migrations set the passwords of the database roles, and those roles are shared by every
database on the Postgres server. The runner therefore migrates the test database with the
passwords your stack really uses (read from `docker compose config`, never printed). Anything
else that migrates a second database on the same server must do the same.
