// ADR-096: word-level diff and summary for the test case version compare screen.

export type DiffOp = 'same' | 'add' | 'del'
export interface DiffSegment {
  op: DiffOp
  text: string
}

// Words and the whitespace between them are separate tokens, so the text
// re-joins exactly and highlights never swallow the neighbouring space.
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? []
}

function pushSegment(out: DiffSegment[], op: DiffOp, text: string) {
  const last = out[out.length - 1]
  if (last && last.op === op) last.text += text
  else out.push({ op, text })
}

/** Word-level diff of two strings (longest common subsequence). */
export function diffWords(before: string | null | undefined, after: string | null | undefined): DiffSegment[] {
  const a = tokenize(before ?? '')
  const b = tokenize(after ?? '')
  const n = a.length
  const m = b.length
  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffSegment[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushSegment(out, 'same', a[i])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      pushSegment(out, 'del', a[i++])
    } else {
      pushSegment(out, 'add', b[j++])
    }
  }
  while (i < n) pushSegment(out, 'del', a[i++])
  while (j < m) pushSegment(out, 'add', b[j++])
  return out
}

export interface StepDiffLike {
  change: 'added' | 'removed' | 'modified' | 'unchanged'
}
export interface CompareLike {
  title_changed: boolean
  description_changed: boolean
  steps: StepDiffLike[]
}

export interface DiffCounts {
  changed: number
  added: number
  removed: number
  unchanged: number
}

export function countStepChanges(steps: StepDiffLike[]): DiffCounts {
  const counts: DiffCounts = { changed: 0, added: 0, removed: 0, unchanged: 0 }
  for (const s of steps) {
    if (s.change === 'modified') counts.changed++
    else if (s.change === 'added') counts.added++
    else if (s.change === 'removed') counts.removed++
    else counts.unchanged++
  }
  return counts
}

/** One-line summary, e.g. "Title changed, 2 steps changed, 1 added". */
export function summarizeCompare(c: CompareLike): string {
  const counts = countStepChanges(c.steps)
  const parts: string[] = []
  if (c.title_changed) parts.push('title changed')
  if (c.description_changed) parts.push('description changed')
  if (counts.changed) parts.push(`${counts.changed} ${counts.changed === 1 ? 'step' : 'steps'} changed`)
  if (counts.added) parts.push(`${counts.added} added`)
  if (counts.removed) parts.push(`${counts.removed} removed`)
  if (parts.length === 0) return 'No differences between these versions'
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
