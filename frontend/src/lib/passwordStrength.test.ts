import { describe, expect, it } from 'vitest'

import { passwordStrength } from '@/lib/passwordStrength'

describe('passwordStrength', () => {
  it('short is too short', () => expect(passwordStrength('Ab1').label).toBe('Too short'))
  it('single class 8 chars is weak', () => expect(passwordStrength('abcdefgh').label).toBe('Weak'))
  it('repeated char is weak', () => expect(passwordStrength('aaaaaaaaaaaaaaaa').score).toBe(1))
  it('mixed 12 chars is good or better', () => expect(passwordStrength('Abcdefgh1234').score).toBeGreaterThanOrEqual(3))
  it('long mixed with symbol is strong', () => expect(passwordStrength('Abcdefgh1234!xyz').label).toBe('Strong'))
})
