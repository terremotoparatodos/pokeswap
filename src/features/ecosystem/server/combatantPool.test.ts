// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { loadBattleCatalog, loadLearnsets } from '../../battle/catalog'
import { isExecutable } from '../../battle/rules'
import { deriveStats, statsFromTuple } from '../../pokemon/model/stats'
import { prepareEncounterBattles } from './encounterBattleRuntime'
// @ts-expect-error — generated JS bundle; the source is the typed API
import { prepareEncounterBattles as prepareBundle } from '../../../../services/realtime/src/world/ecosystem/encounterBattle.generated.js'
import { publicBattleView } from '../../../../services/realtime/src/world/ecoBattlePublic.js'
import { presentCombatant, spectatorSnapshot } from '../../world/domain/ecoBattlePresentation'

describe('ECO-COMBATANT-1 legal synthetic pool', () => {
  it('constructs all six from catalog stats and supported legal moves; source and generated bundle match owner/public presentation', async () => {
    const index = await loadBattleCatalog(), learnsets = await loadLearnsets()
    for (const prepare of [prepareEncounterBattles, prepareBundle as typeof prepareEncounterBattles]) {
      const result = await prepare()
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.reason)
      expect(result.battles.combatants.map(c => c.speciesId)).toEqual([25, 19, 43, 74, 41, 10])
      for (const { speciesId } of result.battles.combatants) {
        const start = result.battles.start({ battleId: `pool-${speciesId}`, controllerId: 'synthetic', speciesId: 19, playerSpeciesId: speciesId, seed: 7 })
        expect(start.ok, `species ${speciesId}`).toBe(true)
        if (!start.ok) throw new Error(start.reason)
        const snapshot = start.battle.snapshot(), c = snapshot.combatants['player-0']
        expect(c.level).toBe(12)
        expect(c.instance.speciesId).toBe(speciesId)
        const form = index.formOf(speciesId)!
        expect(c.stats).toEqual(deriveStats({ base: statsFromTuple(form.baseStats), level: 12, ivs: c.instance.ivs, evs: c.instance.evs, nature: index.nature(c.instance.natureId) }))
        const learnset = learnsets.get(speciesId)!
        expect(c.instance.moves.length).toBeGreaterThan(0)
        expect(c.instance.moves.length).toBeLessThanOrEqual(4)
        for (const { moveId } of c.instance.moves) {
          expect(isExecutable(index.move(moveId)!)).toBe(true)
          expect(learnset.level.some(([id, at]) => id === moveId && at <= 12) || learnset.machine.includes(moveId)).toBe(true)
        }
        const stage = { owner: { tx: 0, ty: 0 }, pokemon: { tx: 1, ty: 0 }, wild: { tx: 2, ty: 0 }, pokemonFacing: 'right' as const, wildFacing: 'left' as const }
        const view = publicBattleView({ battleId: snapshot.battleId, encounterId: 'e', areaId: 'pradera', seq: 1, stage, snapshot, connected: true })!
        const clock = { receivedAt: 0, now: 400, connected: true }
        expect(presentCombatant(spectatorSnapshot(view, false), 'player-0', clock)).toEqual(presentCombatant(snapshot, 'player-0', clock))
        expect(view.stage).toEqual(stage)
      }
    }
  })
})
