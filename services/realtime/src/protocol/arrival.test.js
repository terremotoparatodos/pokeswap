import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVALS, TOWN_FROM_PRADERA, arrivalFor } from './arrival.js'

test('arrival mirrors the client: portal trips land by the gate, resets land on the area spawn', () => {
  assert.deepEqual(arrivalFor('pradera', 'ciudad-corazon'), ARRIVALS.pradera)
  assert.deepEqual(arrivalFor('ciudad-corazon', 'pradera'), TOWN_FROM_PRADERA)
  // Same-area requests are the "Ciudad" escape hatch and the client's safe-spawn repair.
  assert.deepEqual(arrivalFor('ciudad-corazon', 'ciudad-corazon'), { tx: 31, ty: 20, dir: 'down' })
  assert.deepEqual(arrivalFor('pradera', 'pradera'), { tx: -5, ty: -69, dir: 'down' })
  assert.equal(arrivalFor('bosque', 'ciudad-corazon'), null)
})

test('the Pradera arrival is not the town west-gate tile it was confused with', () => {
  assert.notDeepEqual({ tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty }, { tx: TOWN_FROM_PRADERA.tx, ty: TOWN_FROM_PRADERA.ty })
})
