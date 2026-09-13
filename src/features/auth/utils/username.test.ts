import { describe, it, expect } from 'vitest'
import { isValidUsername, validateUsername, normalizeUsernameInput } from './username'

describe('isValidUsername', () => {
  it('accepts letters, numbers, underscore, hyphen', () => {
    expect(isValidUsername('Red')).toBe(true)
    expect(isValidUsername('ash_ketchum')).toBe(true)
    expect(isValidUsername('trainer-99')).toBe(true)
    expect(isValidUsername('abc')).toBe(true)
    expect(isValidUsername('a'.repeat(24))).toBe(true)
  })

  it('rejects usernames shorter than 3 chars', () => {
    expect(isValidUsername('')).toBe(false)
    expect(isValidUsername('ab')).toBe(false)
  })

  it('rejects usernames longer than 24 chars', () => {
    expect(isValidUsername('a'.repeat(25))).toBe(false)
  })

  it('rejects special chars that could inject markup', () => {
    expect(isValidUsername('<script>alert(1)</script>')).toBe(false)
    expect(isValidUsername('user@example')).toBe(false)
    expect(isValidUsername('user name')).toBe(false)
    expect(isValidUsername('"><img src=x>')).toBe(false)
    expect(isValidUsername("'; DROP TABLE profiles; --")).toBe(false)
  })
})

describe('validateUsername', () => {
  it('returns null for a valid username', () => {
    expect(validateUsername('Red')).toBeNull()
    expect(validateUsername('ash_ketchum-99')).toBeNull()
  })

  it('returns an error string for invalid usernames', () => {
    expect(validateUsername('ab')).toMatch(/3 caracteres/)
    expect(validateUsername('a'.repeat(25))).toMatch(/24/)
    expect(validateUsername('bad user!')).toMatch(/Solo se permiten/)
  })
})

describe('normalizeUsernameInput', () => {
  it('strips disallowed chars', () => {
    expect(normalizeUsernameInput('ash ketchum!')).toBe('ashketchum')
    expect(normalizeUsernameInput('<script>')).toBe('script')
    expect(normalizeUsernameInput('user@name')).toBe('username')
  })

  it('caps at 24 chars', () => {
    expect(normalizeUsernameInput('a'.repeat(30))).toHaveLength(24)
  })

  it('preserves hyphen and underscore', () => {
    expect(normalizeUsernameInput('ash_ketchum-99')).toBe('ash_ketchum-99')
  })
})
