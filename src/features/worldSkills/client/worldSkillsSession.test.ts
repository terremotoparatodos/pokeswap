import { describe, expect, it } from 'vitest'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from '../../world/state/sharedWorld'
import { RESOURCE_BY_ID } from '../../skills/domain/resources'
import { totalXpForLevel } from '../../skills/domain/xpCurve'
import { createWorldSkillsSession, refusalText } from './worldSkillsSession'

// The client session only shows what the server said. These tests drive it
// with server messages (as ColyseusPresence would) and check what it shows.

function setup() {
  const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  world.attach((type, payload) => sent.push({ type, payload: payload as Record<string, unknown> }))
  world.snapshot({ now: 1_000, areaId: 'pradera', chunks: ['-1,-4'], nodes: [] })
  const session = createWorldSkillsSession(world, () => 1_000)
  return { world, session, sent }
}

const TREE = RESOURCE_BY_ID.get('common_tree')!
const PINE = RESOURCE_BY_ID.get('pine_tree')!

describe('the shared-world Skills session', () => {
  it('takes XP, materials and the Pokémon roster from the server, never from itself', () => {
    const { world, session } = setup()
    expect(session.workers()).toBeNull()
    world.playerState({ playerId: 'me', xp: { woodcutting: 38 }, materials: { common_log: 2 }, pokemon: [{ instanceId: 123, speciesId: 123 }] })
    expect(session.xp()).toEqual({ woodcutting: 38, mining: 0, farming: 0 })
    expect(session.inventory()).toEqual({ common_log: 2 })
    expect(session.workers()).toEqual([{ instanceId: '123', speciesId: 123 }])
  })

  it('sends only an intent: node, Pokémon, request id (and a crop to plant)', async () => {
    const { world, session, sent } = setup()
    const pending = session.begin('pradera:-6:-64:tree', { instanceId: '123', speciesId: 123 })
    expect(sent[sent.length - 1]).toEqual({ type: 'world:work', payload: { nodeId: 'pradera:-6:-64:tree', pokemonInstanceId: 123, requestId: 1 } })
    world.workResult({ requestId: 1, ok: true, actionId: 'act-1', nodeId: 'pradera:-6:-64:tree', startedAt: 1_000, endsAt: 4_000 })
    expect(await pending).toEqual({ allowed: true, actionId: 'act-1', durationMs: 3_000 })
    void session.begin('pradera:-7:-73:plot', { instanceId: '241', speciesId: 241 }, 'oran')
    expect(sent[sent.length - 1]?.payload).toEqual({ nodeId: 'pradera:-7:-73:plot', pokemonInstanceId: 241, requestId: 2, cropId: 'oran' })
  })

  it('turns refusals into words, preferring SKILLS’ own message', async () => {
    const { world, session } = setup()
    const pending = session.begin('pradera:-6:-64:tree', { instanceId: '123', speciesId: 123 })
    world.workResult({ requestId: 1, ok: false, reason: 'level-too-low', message: 'Requiere Talar 12' })
    expect(await pending).toEqual({ allowed: false, message: 'Requiere Talar 12' })
    expect(refusalText('busy')).toBe('Otro Pokémon ya está trabajando acá.')
  })

  it('shows the settled result and updates XP and materials from it', () => {
    const { world, session } = setup()
    world.playerState({ playerId: 'me', xp: {}, materials: {}, pokemon: [] })
    expect(session.result('act-1')).toBeUndefined()
    world.workDone({ actionId: 'act-1', ok: true, status: 'applied', summary: {
      skillId: 'woodcutting', xpGained: 10, xpAfter: 10, rewards: [{ itemId: 'common_log', quantity: 1, bonus: false }],
      levelBefore: 1, levelAfter: 1, levelUpLine: null, unlocks: [],
    } })
    const result = session.result('act-1')
    expect(result && 'settlement' in result ? result.settlement.xpGained : null).toBe(10)
    expect(session.xp().woodcutting).toBe(10)
    expect(session.inventory()).toEqual({ common_log: 1 })
    world.workDone({ actionId: 'act-2', ok: false, reason: 'moved' })
    expect(session.result('act-2')).toBeNull()
  })

  it('node state: depleted from the WORLD mirror, locked from the player’s level', () => {
    const { world, session } = setup()
    world.playerState({ playerId: 'me', xp: { woodcutting: totalXpForLevel(11) }, materials: {}, pokemon: [] })
    expect(session.nodeState('pradera:-6:-64:tree', TREE).status).toBe('available')
    expect(session.nodeState('pradera:-6:-64:pine', PINE).status).toBe('locked_level')
    world.batch({ now: 1_000, nodes: [{ id: 'pradera:-6:-64:tree', state: 'depleted', version: 3, respawnAt: 31_000 }] })
    expect(session.nodeState('pradera:-6:-64:tree', TREE)).toEqual({ status: 'depleted', remainingCharges: 0, respawnInSeconds: 30 })
  })
})
