import { describe, expect, it } from 'vitest'
import { HEARTHOME, LOBBY_ID } from '../../wildlands/areas/atlas'
import { applyPatch, diffCities, fingerprint, parsePatch, patchIsEmpty, patchSummary, serializePatch } from './cityPatch'
import { addProp, deleteEntity, duplicateEntity, moveEntity, paintTerrain, setFacing, setSignText } from './editOps'
import { deepFreeze, fromTownDef, SPAWN_REF, type LabCity } from './labCity'
import { clearDraft, DRAFT_KEY, loadDraft, saveDraft, type DraftStore } from './labDraft'

const baseline = (): LabCity => deepFreeze(fromTownDef(HEARTHOME))
const ok = (r: { ok: true; city: LabCity } | { ok: false; errors: readonly string[] }): LabCity => {
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.city
}

/** The human acceptance workflow, as data: move a tree-like prop, delete a rock-like one, … */
function proposal(base: LabCity): LabCity {
  let city = ok(moveEntity(HEARTHOME, base, { type: 'prop', id: 'lamp@28,18' }, { tx: 24, ty: 22 }))
  city = ok(deleteEntity(city, { type: 'prop', id: 'hedge@35,35' }))
  city = ok(duplicateEntity(HEARTHOME, city, { type: 'prop', id: 'lamp@34,18' }))
  city = ok(addProp(HEARTHOME, city, 'pine', { tx: 44, ty: 21 }))
  city = ok(moveEntity(HEARTHOME, city, SPAWN_REF, { tx: 32, ty: 21 }))
  city = setFacing(city, SPAWN_REF, 'up')
  city = paintTerrain(city, [{ tx: 30, ty: 31 }, { tx: 31, ty: 31 }], 'g')
  city = ok(moveEntity(HEARTHOME, city, { type: 'building', id: 'mart' }, { tx: 28, ty: 21 }))
  city = ok(moveEntity(HEARTHOME, city, { type: 'resident', id: 'resident-3' }, { tx: 22, ty: 22 }))
  city = ok(deleteEntity(city, { type: 'wanderer', id: 'wanderer-4' }))
  city = setSignText(city, 'sign@28,15', 'Bienvenidos a la beta')
  return city
}

const sameCity = (a: LabCity, b: LabCity) => expect(fingerprint(a)).toBe(fingerprint(b))

describe('export', () => {
  it('is empty for an untouched copy', () => {
    const patch = diffCities(baseline(), baseline(), LOBBY_ID)
    expect(patchIsEmpty(patch)).toBe(true)
    expect(patchSummary(patch)).toBe('sin cambios')
  })

  it('describes only the differences from the baseline', () => {
    const patch = diffCities(baseline(), proposal(baseline()), LOBBY_ID)
    expect(patch.props.moved).toEqual([{ id: 'lamp@28,18', from: { tx: 28, ty: 18 }, to: { tx: 24, ty: 22 } }])
    expect(patch.props.removed.map(p => p.id)).toEqual(['hedge@35,35'])
    expect(patch.props.added.map(p => p.kind).sort()).toEqual(['lamp', 'pine'])
    expect(patch.props.modified).toEqual([{ id: 'sign@28,15', from: { text: 'Ciudad Corazón · Donde los corazones se encuentran' }, to: { text: 'Bienvenidos a la beta' } }])
    expect(patch.terrain).toEqual([{ tx: 30, ty: 31, from: 's', to: 'g' }, { tx: 31, ty: 31, from: 's', to: 'g' }])
    expect(patch.spawn).toEqual({ from: { tx: 31, ty: 20, dir: 'down' }, to: { tx: 32, ty: 21, dir: 'up' } })
    expect(patch.buildings.moved).toEqual([{ id: 'mart', from: { x: 28, y: 26, door: { tx: 30, ty: 29 } }, to: { x: 28, y: 21, door: { tx: 30, ty: 24 } } }])
    expect(patch.residents.moved.map(m => m.id)).toEqual(['resident-3'])
    expect(patch.wanderers.removed.map(w => w.id)).toEqual(['wanderer-4'])
    expect(patch.notes.join()).toMatch(/pine/)
  })

  it('is deterministic: same copy, same bytes, whatever the edit order', () => {
    const base = baseline()
    const a = serializePatch(diffCities(base, proposal(base), LOBBY_ID))
    expect(serializePatch(diffCities(base, proposal(base), LOBBY_ID))).toBe(a)
    // Reverse the list order of the copy: the patch must not care.
    const copy = proposal(base)
    const shuffled: LabCity = { ...copy, props: [...copy.props].reverse(), residents: [...copy.residents].reverse(), wanderers: [...copy.wanderers].reverse() }
    expect(serializePatch(diffCities(base, shuffled, LOBBY_ID))).toBe(a)
  })
})

describe('buildings, fountains and exits', () => {
  it('round-trips deleted and duplicated buildings, fountains and exits', () => {
    const base = baseline()
    let city = ok(deleteEntity(base, { type: 'building', id: 'house1' }))
    city = ok(duplicateEntity(HEARTHOME, city, { type: 'building', id: 'mart' }))
    city = ok(deleteEntity(city, { type: 'gate', id: 'gate-costa' }))
    city = ok(duplicateEntity(HEARTHOME, city, { type: 'gate', id: 'gate-pradera' }))
    city = ok(deleteEntity(city, { type: 'fountain', id: 'fountain-2' }))
    const patch = diffCities(base, city, LOBBY_ID)
    expect(patch.buildings.removed.map(b => b.id)).toEqual(['house1'])
    expect(patch.buildings.added.map(b => b.id)).toEqual(['building-new-1'])
    expect(patch.gates.removed.map(g => g.id)).toEqual(['gate-costa'])
    expect(patch.gates.added.map(g => g.to)).toEqual(['pradera'])
    expect(patch.fountains.removed.map(f => f.id)).toEqual(['fountain-2'])
    const text = serializePatch(patch)
    const parsed = parsePatch(text)
    const applied = applyPatch(base, parsed.ok ? parsed.value : null)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    sameCity(applied.city, city)
    expect(serializePatch(diffCities(base, applied.city, LOBBY_ID))).toBe(text)
  })

  it('still imports a version 1 patch', () => {
    const base = baseline()
    const v2 = diffCities(base, proposal(base), LOBBY_ID)
    const v1 = JSON.parse(serializePatch(v2))
    v1.version = 1
    for (const k of ['buildings', 'fountains', 'gates']) { delete v1[k].added; delete v1[k].removed }
    const applied = applyPatch(base, v1)
    expect(applied.ok).toBe(true)
    if (applied.ok) sameCity(applied.city, proposal(base))
  })
})

describe('import', () => {
  it('baseline + patch → the same working copy (round trip through JSON)', () => {
    const base = baseline()
    const copy = proposal(base)
    const text = serializePatch(diffCities(base, copy, LOBBY_ID))
    const parsed = parsePatch(text)
    expect(parsed.ok).toBe(true)
    const applied = applyPatch(base, parsed.ok ? parsed.value : null)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.conflicts).toEqual([])
    sameCity(applied.city, copy)
    // And exporting the imported copy gives the very same patch.
    expect(serializePatch(diffCities(base, applied.city, LOBBY_ID))).toBe(text)
  })

  it('rejects garbage and unknown formats', () => {
    expect(parsePatch('{nope').ok).toBe(false)
    expect(applyPatch(baseline(), { format: 'other' }).ok).toBe(false)
    expect(applyPatch(baseline(), null).ok).toBe(false)
  })

  it('rejects ids the baseline does not have', () => {
    const patch = diffCities(baseline(), proposal(baseline()), LOBBY_ID)
    patch.props.removed.push({ id: 'lamp@99,99', kind: 'lamp', tx: 99, ty: 99 })
    const result = applyPatch(baseline(), patch)
    expect(result.ok).toBe(false)
  })

  it('reports conflicts when the baseline moved since the patch was made', () => {
    const base = baseline()
    const patch = diffCities(base, proposal(base), LOBBY_ID)
    const drifted = deepFreeze(ok(moveEntity(HEARTHOME, base, { type: 'prop', id: 'lamp@28,18' }, { tx: 29, ty: 22 })))
    const result = applyPatch(drifted, patch)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.conflicts.length).toBeGreaterThan(0)
  })

  it('never mutates the baseline it applies to', () => {
    const base = baseline()
    const before = JSON.stringify(base)
    applyPatch(base, diffCities(base, proposal(base), LOBBY_ID))
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('local draft', () => {
  const memory = (): DraftStore & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) }
  }

  it('saves and restores the patch text, separately from any export', () => {
    const store = memory()
    expect(saveDraft(store, '{"x":1}', new Date('2026-09-18T12:00:00Z'))).toBe(true)
    expect(loadDraft(store)).toEqual({ savedAt: '2026-09-18T12:00:00.000Z', patch: '{"x":1}' })
    clearDraft(store)
    expect(loadDraft(store)).toBeNull()
  })

  it('treats a corrupt or blocked store as no draft', () => {
    const store = memory()
    store.data.set(DRAFT_KEY, '{broken')
    expect(loadDraft(store)).toBeNull()
    const blocked: DraftStore = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    expect(loadDraft(blocked)).toBeNull()
    expect(saveDraft(blocked, 'x', new Date())).toBe(false)
    expect(() => clearDraft(blocked)).not.toThrow()
  })
})
