import { describe, expect, it } from 'vitest'

import { chartFilename, toCsv } from './chartExport'

describe('toCsv', () => {
  it('joins rows with CRLF and leaves plain cells unquoted', () => {
    expect(toCsv(['Date', 'Pass'], [['2026-01-01', 3]])).toBe('Date,Pass\r\n2026-01-01,3')
  })

  it('quotes commas, line breaks and doubles embedded quotes', () => {
    const csv = toCsv(['Name', 'Note'], [['Smith, Ann', 'said "ok"\nthen left']])
    expect(csv).toBe('Name,Note\r\n"Smith, Ann","said ""ok""\nthen left"')
  })

  it('writes empty cells for null / undefined and keeps numbers as they are', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, -4]])).toBe('a,b,c\r\n,,-4')
  })

  it('neutralises spreadsheet formulas in text but not numeric strings', () => {
    expect(toCsv(['x'], [['=SUM(A1)'], ['-12'], ['@cmd']])).toBe("x\r\n'=SUM(A1)\r\n-12\r\n'@cmd")
  })
})

describe('chartFilename', () => {
  it('slugs the title and appends the date', () => {
    expect(chartFilename('Execution Trends (last 30 days)', new Date('2026-11-22T10:00:00Z'))).toBe(
      'execution-trends-last-30-days-2026-11-22',
    )
    expect(chartFilename('Project & Test Case Distribution', new Date('2026-01-02T00:00:00Z'))).toBe(
      'project-and-test-case-distribution-2026-01-02',
    )
  })
})
