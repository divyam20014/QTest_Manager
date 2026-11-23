// Pure rules of the multi-tag input (defect labels: at most 20 labels of at most 40 characters,
// trimmed, lower-cased and de-duplicated case-insensitively, as the API stores them).

export interface TagLimits {
  max: number
  maxLength: number
}

/** The stored form of a typed tag. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Why `raw` cannot be added to `existing` (null when it can). */
export function tagProblem(raw: string, existing: string[], limits: TagLimits): string | null {
  const tag = normalizeTag(raw)
  if (!tag) return 'Type a label first'
  if (tag.length > limits.maxLength) return `A label can be at most ${limits.maxLength} characters`
  if (existing.some((t) => t === tag)) return `"${tag}" is already added`
  if (existing.length >= limits.max) return `At most ${limits.max} labels are allowed`
  return null
}

/** Splits pasted text (commas, semicolons, new lines) into candidate tags. */
export function splitTags(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Adds as many of the candidates as the limits allow; returns the new list and the first problem met. */
export function addTags(existing: string[], candidates: string[], limits: TagLimits): { tags: string[]; problem: string | null } {
  let tags = existing
  let problem: string | null = null
  for (const candidate of candidates) {
    const p = tagProblem(candidate, tags, limits)
    if (p) {
      problem = problem ?? p
      continue
    }
    tags = [...tags, normalizeTag(candidate)]
  }
  return { tags, problem }
}
