// WORLD VISUAL-2 guard: the server steps a trainer aside when its Pokémon
// starts working. That automatic move must never land on Pradera's return
// portal (it would send the player back to town). The portal comes from the
// client's real area definition, the nodes from the shared layout, the waiting
// tile from the server's own rule: a change to any of the three that lets the
// relocation reach the portal fails here.

import { describe, expect, it } from 'vitest'
import { Atlas } from '../../wildlands/areas/atlas'
import { isPortalTile } from '../../wildlands/engine/area'
import { WORLD_AREAS } from '../../../../services/realtime/src/world/areas.js'
import { PLOTS } from '../../../../services/realtime/src/world/plots.js'
import { resourceAt } from '../../../../services/realtime/src/world/resourceLayout.js'
import { standableTile, workPlacement } from '../../../../services/realtime/src/world/workPlacement.js'

const pradera = new Atlas().get('pradera')
const spawn = WORLD_AREAS.pradera.spawn!
const PORTAL = { tx: spawn.tx, ty: spawn.ty - 1 }
/** Far beyond reach: a waiting tile is at most two tiles from its node. */
const RADIUS = 48
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

function workableNodes() {
  const nodes: { id: string; tx: number; ty: number }[] = [...PLOTS]
  for (let ty = spawn.ty - RADIUS; ty <= spawn.ty + RADIUS; ty++) {
    for (let tx = spawn.tx - RADIUS; tx <= spawn.tx + RADIUS; tx++) {
      const node = resourceAt('pradera', tx, ty)
      if (node) nodes.push(node)
    }
  }
  return nodes
}

describe('Pradera return portal vs. automatic trainer relocation', () => {
  it('the portal is where this guard expects it: one tile north of the spawn, and the only one', () => {
    expect(pradera.portals.flatMap(portal => portal.tiles)).toEqual([PORTAL])
    expect(pradera.arrival(null)).toMatchObject(spawn)
  })

  it('no waiting tile computed for any workable node, from any valid side, is the portal', () => {
    const isOpen = standableTile('pradera')
    const nodes = workableNodes()
    let checked = 0
    let nearPortal = 0
    for (const node of nodes) {
      for (const [dx, dy] of SIDES) {
        const trainer = { tx: node.tx + dx, ty: node.ty + dy }
        // A valid interaction side: a tile the client lets the player stand on.
        if (pradera.isSolid(trainer.tx, trainer.ty) || pradera.isWater(trainer.tx, trainer.ty) || isPortalTile(pradera, trainer.tx, trainer.ty)) continue
        const placement = workPlacement(node, trainer, isOpen)
        if (!placement) continue
        checked++
        if (Math.abs(placement.wait.tx - PORTAL.tx) + Math.abs(placement.wait.ty - PORTAL.ty) <= 3) nearPortal++
        expect(isPortalTile(pradera, placement.wait.tx, placement.wait.ty), `${node.id} worked from ${trainer.tx},${trainer.ty}`).toBe(false)
        expect(placement.wait, node.id).not.toMatchObject(PORTAL)
      }
    }
    // The sweep is not vacuous: today 87 nodes, 265 sides, 7 waiting tiles within 3 tiles of the portal.
    expect(nodes.length).toBeGreaterThan(40)
    expect(checked).toBeGreaterThan(120)
    expect(nearPortal).toBeGreaterThan(0)
  })
})
