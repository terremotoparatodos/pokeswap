import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORLD_MESSAGE as M, type EcoCombatantState } from '../../../../services/realtime/src/world/worldProtocol.js'
import { EcoCombatantSelection, type EcoCombatantSink } from './ecoCombatantSelection'

const confirmed = (speciesId = 25, requestId: number | null = null): EcoCombatantState => ({ requestId, ok: true, speciesId, options: [25, 19, 43, 74, 41, 10].map(id => ({ speciesId: id, level: 12 })) })
function setup() {
  let sink: EcoCombatantSink | null = null
  let online = true
  const sent: { type: string; payload: unknown }[] = []
  const selection = new EcoCombatantSelection({
    setEcoCombatantSink: value => { sink = value },
    ecoSend: (type, payload) => { if (!online) return false; sent.push({ type, payload }); return true },
  })
  return { selection, sent, message: (state: EcoCombatantState) => sink?.message(state), offline: () => { online = false } }
}
afterEach(() => vi.useRealTimers())
describe('synthetic choice acknowledgement', () => {
  it('owned mode names only a slot, waits for ACK, refuses readiness on errors and refreshes explicitly', () => {
    const s = setup()
    const own: EcoCombatantState = { requestId: null, ok: true, mode: 'owned', speciesId: null, selectedSlotPokemonId: null,
      attributeSource: 'legacy-m1-derived', options: [{ slotPokemonId: 25, speciesId: 25, level: 12, eligible: true }] }
    s.message(own)
    expect(s.selection.view.ready).toBe(false)
    s.selection.select(25)
    expect(s.sent[0]?.payload).toEqual({ requestId: 1, slotPokemonId: 25 })
    s.message({ ...own, requestId: 1, speciesId: 25, selectedSlotPokemonId: 25, level: 12 })
    expect(s.selection.view).toMatchObject({ ready: true, mode: 'owned', level: 12, attributeSource: 'legacy-m1-derived' })
    s.selection.refresh()
    expect(s.sent[1]?.payload).toEqual({ requestId: 2, refresh: true })
    s.message({ ...own, requestId: 2, speciesId: 25, selectedSlotPokemonId: 25, ok: false, reason: 'locked' })
    expect(s.selection.view.ready).toBe(false)
    s.selection.dispose()
  })
  it('waits for confirmation, ignores stale replies and does not optimistically change species', () => {
    const s = setup()
    expect(s.selection.view.ready).toBe(false)
    s.message(confirmed())
    s.selection.select(43)
    s.selection.select(74)
    expect(s.sent).toEqual([{ type: M.ECO_COMBATANT_SELECT, payload: { requestId: 1, speciesId: 43 } }])
    expect(s.selection.view).toMatchObject({ pending: true, ready: false, speciesId: 25 })
    s.message(confirmed(74, 99))
    expect(s.selection.view.pending).toBe(true)
    s.message(confirmed(43, 1))
    expect(s.selection.view).toMatchObject({ pending: false, ready: true, speciesId: 43 })
    s.selection.select(74)
    s.message({ ...confirmed(43, 2), ok: false, reason: 'in-battle' })
    expect(s.selection.view).toMatchObject({ pending: false, speciesId: 43, reason: 'in-battle' })
    s.selection.dispose()
  })
  it('unanswered selection blocks starting; retry or late acknowledgement restores the authoritative choice', () => {
    vi.useFakeTimers()
    const s = setup()
    s.message(confirmed())
    s.selection.select(43)
    vi.advanceTimersByTime(8_000)
    expect(s.selection.view).toMatchObject({ speciesId: 25, pending: false, ready: false, reason: 'no-answer' })
    s.message(confirmed(43, 1))
    expect(s.selection.view).toMatchObject({ speciesId: 43, ready: true })
    s.selection.select(74)
    s.selection.detached()
    expect(s.selection.view.ready).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    s.message(confirmed(74))
    expect(s.selection.view).toMatchObject({ speciesId: 74, ready: true, reason: null })
    s.offline(); s.selection.select(10)
    expect(s.selection.view).toMatchObject({ speciesId: 74, ready: false, reason: 'offline' })
    s.selection.dispose()
  })
})
