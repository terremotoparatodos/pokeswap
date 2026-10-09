import test from 'node:test'
import assert from 'node:assert/strict'
import { ECO_ENGAGE_RANGE } from './ecoBattles.js'
import { TICK, setup } from './ecoBattlesTestkit.js'

// ECO-BATTLE-ENDING-1: the start limit is 3 tiles, Chebyshev, decided by the server. It limits
// STARTING only: walking away during a running battle never cancels it.

test('E01 the start limit is 3 tiles (Chebyshev): 3 starts, 4 is refused on either axis and diagonal', async () => {
  assert.equal(ECO_ENGAGE_RANGE, 3)
  for (const [dx, dy, ok] of [[3, 0, true], [0, 3, true], [3, 3, true], [4, 0, false], [0, -4, false], [4, 4, false], [-4, 2, false]]) {
    const s = await setup()
    const a = s.join('eco-a')
    const target = s.populated(a)
    const e = s.world.eco.encounter(target.id)
    a.actor.areaId = e.areaId; a.actor.tx = e.tx + dx; a.actor.ty = e.ty + dy
    const answer = s.engage(a, target.id)
    assert.equal(answer.ok, ok, `${dx},${dy}`)
    if (!ok) assert.equal(answer.reason, 'too-far')
  }
})

test('E02 a running battle is not cancelled by distance: the owner walks 10 tiles away and it goes on', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id, 3)
  assert.equal(s.engage(a, target.id).ok, true)
  a.actor.tx += 10
  s.world.viewerMoved(a.client, a.actor)
  s.run(TICK * 20)
  assert.equal(s.world.ecoBattles.isBusy(target.id), true)
  assert.equal(s.reservation('eco-a')?.state, 'active')
})
