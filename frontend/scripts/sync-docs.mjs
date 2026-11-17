// Copies the curated documents listed in src/content/docs/manifest.json from the
// repo's docs/ folder into src/content/docs/<id>.md, so the web image (whose
// Docker build context is ./frontend only) can bundle them for the in-app
// Documentation viewer (/brd). Run `npm run docs:sync` after editing a source
// doc. `--check` changes nothing and exits 1 when a copy is missing or stale.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const contentDir = join(here, '..', 'src', 'content', 'docs')
const docsDir = join(here, '..', '..', 'docs')
const check = process.argv.includes('--check')

const normalize = (text) => text.replace(/\r\n/g, '\n')
const manifest = JSON.parse(readFileSync(join(contentDir, 'manifest.json'), 'utf8'))

let problems = 0
for (const doc of manifest.documents) {
  const source = join(docsDir, doc.source)
  const target = join(contentDir, `${doc.id}.md`)
  if (!existsSync(source)) {
    console.error(`missing source: docs/${doc.source}`)
    problems += 1
    continue
  }
  const wanted = normalize(readFileSync(source, 'utf8'))
  const current = existsSync(target) ? normalize(readFileSync(target, 'utf8')) : null
  if (current === wanted) continue
  if (check) {
    console.error(`stale: ${doc.id}.md (run npm run docs:sync)`)
    problems += 1
  } else {
    writeFileSync(target, wanted)
    console.log(`updated ${doc.id}.md`)
  }
}
process.exit(problems ? 1 : 0)
