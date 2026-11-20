// ADR-089: the in-app documents are no longer bundled into the web build. They
// are served by the API from backend/app/docs_content, copied from the repo's
// docs/ folder by backend/scripts/sync_docs.py. This wrapper keeps the old
// `npm run docs:sync` / `docs:check` commands working by running that script.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const venv = join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3'
const result = spawnSync(python, ['-m', 'scripts.sync_docs', ...process.argv.slice(2)], {
  cwd: backend,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
