// ECO-GAMEPLAY-1 (experimental): SharedWorld keeps the server's ECO population of the CURRENT area
// only, and carries the dev test retirement to the server and back. It decides nothing.

import { describe, expect, it, vi } from 'vitest'
import type { EcoArea } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from './sharedWorld'

const world = () => new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
const eco = (areaId: string, ids: string[]): EcoArea => ({ protocol: 1, areaId, status: 'active', encounters: ids.map((id, i) => ({ id, groupId: id, speciesId: 19, tx: i, ty: 0 })) })

describe('SharedWorld · ECO population', () => {
  it('takes it from the snapshot and from whole-area messages of the current area only', () => {
    const w = world()
    w.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: eco('pradera', ['a']) })
    expect(w.ecoArea('pradera')?.encounters.map(e => e.id)).toEqual(['a'])
    expect(w.ecoArea('cueva-inicial')).toBeNull()
    w.eco({ now: 2, eco: eco('pradera', ['a', 'b']) })
    expect(w.ecoArea('pradera')?.encounters).toHaveLength(2)
    w.eco({ now: 3, eco: eco('cueva-inicial', ['z']) }) // crossed an area change: never shown here
    expect(w.ecoArea('pradera')?.encounters.map(e => e.id)).toEqual(['a', 'b'])
    expect(w.ecoArea('cueva-inicial')).toBeNull()
  })

  it('a snapshot without ECO (no experiment) means none: the roster path applies', () => {
    const w = world()
    w.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: eco('pradera', ['a']) })
    w.snapshot({ now: 2, areaId: 'pradera', chunks: [], nodes: [], wild: { areaId: 'pradera', epoch: 1, entities: [] }, wildStatus: 'ready' })
    expect(w.ecoArea('pradera')).toBeNull()
    expect(w.wildRoster('pradera')).not.toBeNull()
  })

  it('notifies listeners of every new list', () => {
    const w = world()
    const seen: (string[] | null)[] = []
    w.onEco(area => seen.push(area ? area.encounters.map(e => e.id) : null))
    w.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], eco: eco('pradera', ['a']) })
    w.eco({ now: 2, eco: eco('pradera', []) })
    expect(seen).toEqual([null, ['a'], []])
  })

  it('carries a dev test retirement to the server and resolves with its answer; nothing else is sent', async () => {
    const w = world()
    const sent: [string, unknown][] = []
    w.attach((type, payload) => sent.push([type, payload]))
    const pending = w.ecoDevRetire('eco-n:pradera:nest:1:0')
    expect(sent).toEqual([[WORLD_MESSAGE.ECO_DEV_RETIRE, { requestId: 1, encounterId: 'eco-n:pradera:nest:1:0' }]])
    w.ecoRetireResult({ requestId: 1, encounterId: 'eco-n:pradera:nest:1:0', ok: false, reason: 'other-area' })
    await expect(pending).resolves.toEqual({ requestId: 1, encounterId: 'eco-n:pradera:nest:1:0', ok: false, reason: 'other-area' })
  })

  it('offline, or disconnected while waiting, the retirement resolves as unavailable', async () => {
    vi.useFakeTimers()
    try {
      const offline = world()
      await expect(offline.ecoDevRetire('x')).resolves.toMatchObject({ ok: false, reason: 'unavailable' })
      const w = world()
      w.attach(() => {})
      const pending = w.ecoDevRetire('x')
      w.detach()
      await expect(pending).resolves.toMatchObject({ ok: false, reason: 'unavailable' })
    } finally {
      vi.useRealTimers()
    }
  })
})
