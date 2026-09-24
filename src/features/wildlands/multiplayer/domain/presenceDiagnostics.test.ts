import { describe, expect, it } from 'vitest'
import { PresenceDiagnostics } from './presenceDiagnostics'

describe('presence diagnostics', () => {
  it('measures move RTT from send to the matching ack and tracks sequences', () => {
    const d = new PresenceDiagnostics()
    d.moveSent(1, 1000); d.moveSent(2, 1100); d.moveSent(3, 1200)
    d.ackReceived(1, 1040)
    d.ackReceived(3, 1290) // an ack covers every earlier pending sequence
    d.ackReceived(2, 1300) // already settled by 3: no sample
    const s = d.snapshot()
    expect(s.sent).toBe(3)
    expect([s.lastSent, s.lastAcked]).toEqual([3, 3])
    expect(s.rttMs.samples).toBe(2)
    expect(s.rttMs.p50).toBe(40)
    expect(s.rttMs.max).toBe(90)
  })

  it('classifies refusals by the public reason and counts repairs', () => {
    const d = new PresenceDiagnostics()
    d.rejected('movement rate denied'); d.rejected('movement replay denied'); d.rejected('area denied')
    d.recoveredFromSolid(); d.reconciled(); d.placementRequested(); d.staleAckIgnored(); d.disconnected()
    expect(d.snapshot()).toMatchObject({
      rejections: { rate: 1, replay: 1, other: 1 },
      solidRecoveries: 1, reconciliations: 1, placements: 1, staleAcksIgnored: 1, disconnects: 1,
    })
  })

  it('keeps pending sends bounded when acks never come', () => {
    const d = new PresenceDiagnostics()
    for (let seq = 1; seq <= 500; seq++) d.moveSent(seq, seq)
    d.ackReceived(1, 10)
    expect(d.snapshot().rttMs.samples).toBe(0)
    d.ackReceived(500, 600)
    expect(d.snapshot().rttMs.samples).toBe(1)
  })
})
