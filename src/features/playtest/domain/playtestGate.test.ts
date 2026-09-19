import { describe, expect, it } from 'vitest'
import {
  BUILD_DEFAULT_GATE, DEFAULT_CLOSED_MESSAGE, codeMatches, normalizeCode, parseGateConfig, resolveAccess,
  type PlaytestGateConfig,
} from './playtestGate'

const open: PlaytestGateConfig = { state: 'open', message: null, accessCode: null }

describe('resolveAccess', () => {
  it('leaves a normal build alone whatever the gate says', () => {
    const closed: PlaytestGateConfig = { state: 'closed', message: 'cerrado', accessCode: 'x' }
    expect(resolveAccess({ mode: 'off', config: closed, submittedCode: null })).toEqual({ status: 'off' })
  })

  it('waits while the remote gate has not answered', () => {
    expect(resolveAccess({ mode: 'on', config: null, submittedCode: null })).toEqual({ status: 'checking' })
  })

  it('opens when the gate is open and no code is required', () => {
    expect(resolveAccess({ mode: 'on', config: open, submittedCode: null })).toEqual({ status: 'open' })
  })

  it('closes with the operator message, and falls back to the default sentence', () => {
    expect(resolveAccess({ mode: 'on', config: { state: 'closed', message: 'Volvemos el sábado', accessCode: null }, submittedCode: null }))
      .toEqual({ status: 'closed', message: 'Volvemos el sábado' })
    expect(resolveAccess({ mode: 'on', config: { state: 'closed', message: null, accessCode: null }, submittedCode: null }))
      .toEqual({ status: 'closed', message: DEFAULT_CLOSED_MESSAGE })
  })

  it('closed beats a correct code: the kill switch is not negotiable', () => {
    const config: PlaytestGateConfig = { state: 'closed', message: null, accessCode: 'abc' }
    expect(resolveAccess({ mode: 'on', config, submittedCode: 'abc' }).status).toBe('closed')
  })

  it('locks until the code is entered, and reports a rejected one', () => {
    const config: PlaytestGateConfig = { state: 'open', message: null, accessCode: 'pikachu' }
    expect(resolveAccess({ mode: 'on', config, submittedCode: null })).toEqual({ status: 'locked', wrongCode: false })
    expect(resolveAccess({ mode: 'on', config, submittedCode: null, wrongCode: true })).toEqual({ status: 'locked', wrongCode: true })
    expect(resolveAccess({ mode: 'on', config, submittedCode: '  PIKACHU ' })).toEqual({ status: 'open' })
  })
})

describe('codeMatches', () => {
  it('accepts anything when no code is configured', () => {
    expect(codeMatches(null, null)).toBe(true)
    expect(codeMatches(null, 'whatever')).toBe(true)
  })

  it('ignores case and surrounding blanks, because the code is read out loud', () => {
    expect(normalizeCode('  PiKa  ')).toBe('pika')
    expect(codeMatches('PiKa', 'pika')).toBe(true)
    expect(codeMatches('pika', 'pika2')).toBe(false)
    expect(codeMatches('pika', null)).toBe(false)
  })
})

describe('parseGateConfig', () => {
  it('reads a well-formed row', () => {
    expect(parseGateConfig({ state: 'closed', message: 'chau', access_code: 'abc' }))
      .toEqual({ state: 'closed', message: 'chau', accessCode: 'abc' })
  })

  it('accepts the camelCase spelling too', () => {
    expect(parseGateConfig({ state: 'open', message: null, accessCode: 'abc' }).accessCode).toBe('abc')
  })

  it('falls back instead of throwing on anything malformed', () => {
    const fallback: PlaytestGateConfig = { state: 'closed', message: 'fb', accessCode: 'fb' }
    expect(parseGateConfig(null, fallback)).toEqual(fallback)
    expect(parseGateConfig('nope', fallback)).toEqual(fallback)
    expect(parseGateConfig({ state: 'banana' }, fallback).state).toBe('closed')
  })

  it('treats blank strings as absent', () => {
    expect(parseGateConfig({ state: 'open', message: '   ', access_code: '' }))
      .toEqual({ state: 'open', message: null, accessCode: null })
  })

  it('ships open by default, so a build flagged as a playtest is playable', () => {
    expect(BUILD_DEFAULT_GATE.state).toBe('open')
  })
})
