// The first minutes, played through the local session exactly as the
// playtest UI drives it: walk up, pick a Pokémon, it works, +XP, +item.

import { describe, expect, it } from 'vitest'
import { RESOURCE_BY_ID } from '../domain/resources'
import { totalXpForLevel } from '../domain/xpCurve'
import type { NodeTarget } from '../scene/nodeTarget'
import { createManualClock } from '../service/memoryAdapters'
import { createLocalSkillsSession } from './localSkillsSession'

const node = (resourceId: string, nodeId = `n-${resourceId}`): NodeTarget => ({ nodeId, resource: RESOURCE_BY_ID.get(resourceId)!, biome: 'grassland' })
const BULBASAUR = { instanceId: 'mine-1', speciesId: 1 }

function play(session: ReturnType<typeof createLocalSkillsSession>, clock: ReturnType<typeof createManualClock>, target: NodeTarget) {
  const begin = session.begin(target, BULBASAUR)
  if (!begin.allowed) throw new Error(begin.message)
  clock.advance(begin.durationMs)
  return { begin, result: session.complete(begin.actionId) }
}

describe('the first minutes, locally', () => {
  it('chops a tree with whatever Pokémon you have: +XP Talar, +1 log', () => {
    const clock = createManualClock(1_000)
    const session = createLocalSkillsSession({ clock })
    const { result } = play(session, clock, node('common_tree'))
    expect(result).toMatchObject({ status: 'settled', settlement: { skillId: 'woodcutting', xpGained: 10 } })
    expect(session.xp().woodcutting).toBe(10)
    expect(session.inventory().common_log).toBeGreaterThanOrEqual(1)
  })

  it('reaches Talar 2 in a handful of chops and says so', () => {
    const clock = createManualClock(1_000)
    const session = createLocalSkillsSession({ clock })
    const lines: string[] = []
    for (let i = 0; i < 4; i++) {
      const { result } = play(session, clock, node('common_tree', `tree-${i}`))
      if (result.status === 'settled' && result.levelUpLine) lines.push(result.levelUpLine)
    }
    expect(lines).toEqual(['Talar 1 → 2'])
  })

  it('shows the pine as "not yet" and turns it into a goal', () => {
    const clock = createManualClock(1_000)
    const session = createLocalSkillsSession({ clock })
    expect(session.nodeState(node('pine_tree')).status).toBe('locked_level')
    expect(session.begin(node('pine_tree'), BULBASAUR)).toMatchObject({ allowed: false, message: 'Requiere Talar 12' })
    session.seedXp('woodcutting', totalXpForLevel(12))
    expect(session.nodeState(node('pine_tree')).status).toBe('available')
  })

  it('empties a tree after a few actions and brings it back later', () => {
    const clock = createManualClock(1_000)
    const session = createLocalSkillsSession({ clock })
    const tree = node('common_tree', 'the-tree')
    const capacity = session.nodeState(tree).remainingCharges
    for (let i = 0; i < capacity; i++) play(session, clock, tree)
    expect(session.nodeState(tree).status).toBe('depleted')
    expect(session.begin(tree, BULBASAUR)).toMatchObject({ allowed: false, reason: 'depleted' })
    clock.advance(tree.resource.world.respawnSeconds * 1000)
    expect(session.nodeState(tree).status).toBe('available')
  })

  it('works one action at a time and settles each once', () => {
    const clock = createManualClock(1_000)
    const session = createLocalSkillsSession({ clock })
    const first = session.begin(node('stone_outcrop'), BULBASAUR)
    expect(session.begin(node('common_tree'), BULBASAUR)).toMatchObject({ allowed: false, reason: 'busy' })
    if (!first.allowed) throw new Error('allowed')
    expect(session.complete(first.actionId).status).toBe('too_early')
    clock.advance(first.durationMs)
    expect(session.complete(first.actionId).status).toBe('settled')
    expect(session.complete(first.actionId).status).toBe('already_settled')
    expect(session.xp().mining).toBe(10)
  })

  it('pays nothing for a cancelled action and frees the worker', () => {
    const clock = createManualClock(1_000)
    const session = createLocalSkillsSession({ clock })
    const begin = session.begin(node('stone_outcrop'), BULBASAUR)
    if (!begin.allowed) throw new Error('allowed')
    session.cancel(begin.actionId)
    expect(session.xp().mining).toBe(0)
    expect(session.begin(node('stone_outcrop'), BULBASAUR).allowed).toBe(true)
  })
})
