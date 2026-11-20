import { describe, expect, it } from 'vitest'

import { resolveApiBase } from './apiBase'

describe('resolveApiBase', () => {
  const dev = 'http://localhost:8000/api/v1'

  it('keeps the configured address when the page is on the same loopback name', () => {
    expect(resolveApiBase(dev, 'localhost')).toBe(dev)
    expect(resolveApiBase('http://127.0.0.1:8000/api/v1', '127.0.0.1')).toBe(
      'http://127.0.0.1:8000/api/v1',
    )
  })

  it("follows the page's loopback name so session cookies stay same-site", () => {
    expect(resolveApiBase(dev, '127.0.0.1')).toBe('http://127.0.0.1:8000/api/v1')
    expect(resolveApiBase('http://127.0.0.1:8000/api/v1', 'localhost')).toBe(dev)
  })

  it('falls back to the local development address when nothing is configured', () => {
    expect(resolveApiBase(undefined, 'localhost')).toBe(dev)
    expect(resolveApiBase('', '127.0.0.1')).toBe('http://127.0.0.1:8000/api/v1')
  })

  it('leaves relative addresses alone (production serves the API from the page origin)', () => {
    expect(resolveApiBase('/api/v1', 'localhost')).toBe('/api/v1')
    expect(resolveApiBase('/api/v1', 'app.example.com')).toBe('/api/v1')
  })

  it('never rewrites a real hostname or a page on a non-loopback host', () => {
    expect(resolveApiBase('https://api.example.com/api/v1', '127.0.0.1')).toBe(
      'https://api.example.com/api/v1',
    )
    expect(resolveApiBase(dev, '192.168.1.20')).toBe(dev)
    expect(resolveApiBase(dev, 'app.example.com')).toBe(dev)
  })

  it('returns an unparseable value untouched', () => {
    expect(resolveApiBase('not a url', '127.0.0.1')).toBe('not a url')
  })
})
