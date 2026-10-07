// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node tooling has no frontend declarations
import { buildEventClassification } from '../../../../scripts/ecosystem/event-classification.mjs'
import raw from './eventClassification.generated.json?raw'
import snapshot from './eventClassification.generated.json'
import core from '../../battle/catalog/generated/core.json'
import { eventCategoryOf, EVENT_SPECIES_IDS } from './eventClassification'
import { ordinaryEncounterExclusion } from './policy'
import { ECO_1_ENCOUNTER_CATALOG } from './initialCatalog'

describe('F4 pinned explicit classification', () => {
  it('is exactly regenerated offline from the hash-verified upstream CSV', async () => {
    expect(await buildEventClassification()).toBe(raw.replace(/\r\n/g, '\n'))
  })
  it('covers every existing species exactly once, including non-events', () => {
    expect(snapshot.species.map(s => [s[0], s[1]])).toEqual(core.species.map(s => [s.id, s.name]))
    expect(snapshot.species).toHaveLength(493)
    expect([EVENT_SPECIES_IDS.legendary.length, EVENT_SPECIES_IDS.mythical.length]).toEqual([26, 9])
    for (const s of core.species) expect(eventCategoryOf(s.id)).not.toBeUndefined()
  })
  it('never treats uncovered species as ordinary', () => {
    expect(eventCategoryOf(494)).toBeUndefined()
    expect(ordinaryEncounterExclusion(ECO_1_ENCOUNTER_CATALOG, 494)).toBe('unclassified')
  })
  it('rejects tampered source data and altered catalog coverage instead of inventing flags', async () => {
    await expect(buildEventClassification(new Uint8Array([1]))).rejects.toThrow(/hash mismatch/)
    await expect(buildEventClassification(undefined, { ...core, species: [...core.species, { id: 99999, name: 'missing' }] })).rejects.toThrow(/coverage/)
  })
})
