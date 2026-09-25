// The PLAYTEST RULE that everything else leans on: level 1, empty hands, the
// party you start with.
//
// Two claims, both easy to assert and embarrassing to get wrong:
//
//   1. the starting party can work the first rung of every skill — no tool,
//      no shop visit, no "wrong type" (SKILLS-1: the Pokémon does the work);
//   2. the first levels of the real curve are cheap enough that a two-hour
//      session visibly moves the number, so nobody invents a multiplier.

import { describe, expect, it } from 'vitest'
import { resolveAptitude } from '../../skills/domain/aptitude/aptitude'
import { CROPS } from '../../skills/domain/farming'
import { RESOURCES } from '../../skills/domain/resources'
import { SKILL_IDS } from '../../skills/domain/skills'
import { evaluateWork } from '../../skills/domain/workRules'
import { levelForXp, totalXpForLevel } from '../../skills/domain/xpCurve'
import { createRoster, partyMembers } from './playtestRoster'

const LEVEL_ONE = Object.fromEntries(SKILL_IDS.map(id => [id, 0])) as Record<(typeof SKILL_IDS)[number], number>

describe('a fresh playtester', () => {
  const party = partyMembers(createRoster())

  it('can work every level-1 resource with any Pokémon of the starting party', () => {
    const starters = RESOURCES.filter(resource => resource.requiredLevel === 1)
    expect(new Set(starters.map(resource => resource.skill))).toEqual(new Set(['woodcutting', 'mining']))
    for (const member of party) {
      for (const resource of starters) {
        const result = evaluateWork({ target: { kind: 'gather', resourceId: resource.id }, skillXp: LEVEL_ONE, workerSpeciesId: member.speciesId })
        expect(result.ok, `${member.speciesId} on ${resource.id}`).toBe(true)
      }
    }
    expect(CROPS[0].requiredLevel).toBe(1)
  })

  it('has someone able to reach even the top rung of every skill later (no deadlock)', () => {
    for (const skill of SKILL_IDS) {
      expect(party.some(member => resolveAptitude(member.speciesId, skill).value >= 2), skill).toBe(true)
    }
  })

  it('moves a number within minutes: level 2 in four basic actions, level 5 in thirty', () => {
    const basic = RESOURCES.find(resource => resource.id === 'common_tree')!
    expect(levelForXp(basic.xp * 4)).toBeGreaterThanOrEqual(2)
    expect(totalXpForLevel(5) / basic.xp).toBeLessThanOrEqual(30)
  })
})
