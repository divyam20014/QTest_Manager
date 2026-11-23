import { describe, expect, it } from 'vitest'

import { addTags, normalizeTag, splitTags, tagProblem } from './tags'

const limits = { max: 3, maxLength: 8 }

describe('tag rules (labels: 20 of 40 characters on a defect)', () => {
  it('normalises to a trimmed, lower-cased, single-spaced tag', () => {
    expect(normalizeTag('  Reg  Test ')).toBe('reg test')
  })

  it('refuses empty, overlong, duplicate (any case) and over-the-limit tags', () => {
    expect(tagProblem('  ', [], limits)).toMatch(/type a label/i)
    expect(tagProblem('x'.repeat(9), [], limits)).toMatch(/at most 8/)
    expect(tagProblem('Smoke', ['smoke'], limits)).toMatch(/already added/)
    expect(tagProblem('d', ['a', 'b', 'c'], limits)).toMatch(/at most 3/i)
    expect(tagProblem('ok', ['a'], limits)).toBeNull()
  })

  it('splits pasted text on commas, semicolons and new lines', () => {
    expect(splitTags('a, b;c\n d,, ')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('adds what fits and reports the first problem', () => {
    const result = addTags(['a'], ['B', 'b', 'c', 'd'], limits)
    expect(result.tags).toEqual(['a', 'b', 'c'])
    expect(result.problem).toMatch(/already added/)
  })

  it('the real limits are 20 labels of 40 characters', () => {
    const real = { max: 20, maxLength: 40 }
    expect(tagProblem('x'.repeat(40), [], real)).toBeNull()
    expect(tagProblem('x'.repeat(41), [], real)).toMatch(/at most 40/)
    expect(tagProblem('new', Array.from({ length: 20 }, (_, i) => `l${i}`), real)).toMatch(/at most 20/i)
  })
})
