import { describe, expect, it } from 'vitest'
import {
  AMBIGUOUS_MIN_LIFETIME_MS, AMBIGUOUS_WINDOW_MS, CLOSE_CODE, PRESENCE_PROTOCOL, closeDecision, joinRefusalDecision, type ClosedSocket,
} from './closePolicy'

// WORLD LOCATION-4 (design §5.3): only a replacement stops; everything else reconnects with resume.

const closed = (over: Partial<ClosedSocket>): ClosedSocket =>
  ({ code: 1006, closing: null, serverProtocol: PRESENCE_PROTOCOL, livedMs: 1_000, now: 1_000_000, lastAmbiguousAt: null, ...over })

describe('closeDecision', () => {
  it('declares protocol 3', () => expect(PRESENCE_PROTOCOL).toBe(3))

  it('4409 stops as replaced; 4503 reconnects (bounded backoff); 1006 / 4002 / 4010 reconnect; 4000 does nothing', () => {
    expect(closeDecision(closed({ code: CLOSE_CODE.REPLACED })).action).toBe('replaced')
    expect(closeDecision(closed({ code: CLOSE_CODE.DRAINING }))).toEqual({ action: 'reconnect', ambiguous: false })
    for (const code of [1006, 4002, 4003, 4010]) expect(closeDecision(closed({ code })).action).toBe('reconnect')
    expect(closeDecision(closed({ code: CLOSE_CODE.CONSENTED })).action).toBe('none')
  })

  it('presence:closing wins over the code (§5.3 case 8)', () => {
    expect(closeDecision(closed({ code: CLOSE_CODE.LEGACY, closing: 'draining' })).action).toBe('reconnect')
    expect(closeDecision(closed({ code: 1006, closing: 'replaced' })).action).toBe('replaced')
  })

  it('4001 from a server that echoed protocol 3 can only be Colyseus\' shutdown: reconnect', () => {
    expect(closeDecision(closed({ code: CLOSE_CODE.LEGACY }))).toEqual({ action: 'reconnect', ambiguous: false })
  })

  it('4001 from an older server (no echo) stops as replaced, unless the socket lived ≥ 30 s and no other 4001 in 60 s (§5.3 case 7)', () => {
    const old = { code: CLOSE_CODE.LEGACY, serverProtocol: null }
    expect(closeDecision(closed({ ...old, livedMs: 5_000 })).action).toBe('replaced')
    const long = closed({ ...old, livedMs: AMBIGUOUS_MIN_LIFETIME_MS })
    expect(closeDecision(long)).toEqual({ action: 'reconnect', ambiguous: true })
    expect(closeDecision({ ...long, lastAmbiguousAt: long.now - AMBIGUOUS_WINDOW_MS + 1 }).action).toBe('replaced')
    expect(closeDecision({ ...long, lastAmbiguousAt: long.now - AMBIGUOUS_WINDOW_MS }).action).toBe('reconnect')
  })

  it('no loop: two old-server tabs evicting each other bounce at most once a minute each', () => {
    let lastAmbiguousAt: number | null = null
    let now = 0
    let bounces = 0
    for (let i = 0; i < 20; i++) {
      now += 31_000 // each socket lives just past the threshold before the other tab evicts it
      const d = closeDecision(closed({ code: CLOSE_CODE.LEGACY, serverProtocol: null, livedMs: 31_000, now, lastAmbiguousAt }))
      if (d.action === 'replaced') break
      bounces++
      lastAmbiguousAt = now
    }
    expect(bounces).toBe(1)
  })
})

describe('joinRefusalDecision', () => {
  it('a resume refused with 4409 stops as replaced; a draining host and others are retried', () => {
    expect(joinRefusalDecision(CLOSE_CODE.REPLACED).action).toBe('replaced')
    expect(joinRefusalDecision(CLOSE_CODE.DRAINING)).toEqual({ action: 'reconnect', ambiguous: false })
    expect(joinRefusalDecision(4210).action).toBe('reconnect')
    expect(joinRefusalDecision(undefined).action).toBe('reconnect')
  })
})
