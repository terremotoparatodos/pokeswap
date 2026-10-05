import test from 'node:test'
import assert from 'node:assert/strict'
import { PortConfigError, resolveGamePort, resolveHealthPort } from './healthPort.js'

const CLOUD = { COLYSEUS_CLOUD: '1' }

test('local default: game 2567, health 2568 (README)', () => {
  assert.equal(resolveGamePort({}), 2567)
  assert.deepEqual(resolveHealthPort({}), { port: 2568, base: 2568, instance: null })
})

test('local: HEALTH_PORT, else PORT + 1; NODE_APP_INSTANCE is not added outside Cloud', () => {
  assert.equal(resolveHealthPort({ PORT: '3000' }).port, 3001)
  assert.equal(resolveHealthPort({ PORT: '3000', HEALTH_PORT: '4000' }).port, 4000)
  // Two local realtimes on 2567 and 2568: no formula moves a health port onto the other's game port.
  assert.equal(resolveHealthPort({ NODE_APP_INSTANCE: '1' }).port, 2568)
  assert.equal(resolveHealthPort({ NODE_APP_INSTANCE: 'garbage' }).port, 2568, 'not read, so not validated, outside Cloud')
})

test('Cloud: the base plus the PM2 slot; an absent slot is 0', () => {
  assert.deepEqual(resolveHealthPort({ ...CLOUD }), { port: 2568, base: 2568, instance: 0 })
  assert.deepEqual(resolveHealthPort({ ...CLOUD, NODE_APP_INSTANCE: '0' }), { port: 2568, base: 2568, instance: 0 })
  assert.deepEqual(resolveHealthPort({ ...CLOUD, NODE_APP_INSTANCE: '1' }), { port: 2569, base: 2568, instance: 1 })
  assert.equal(resolveHealthPort({ ...CLOUD, HEALTH_PORT: '9000', NODE_APP_INSTANCE: '1' }).port, 9001, 'HEALTH_PORT is the base on Cloud')
  assert.equal(resolveHealthPort({ ...CLOUD, COLYSEUS_CLOUD: '' }).instance, 0, 'defined at all = Cloud, like @colyseus/tools')
})

test('Cloud: a present but malformed NODE_APP_INSTANCE is a configuration error, never 0', () => {
  for (const value of ['', ' 1', '1 ', '-1', '1.5', '1e2', '0x1', 'one', '9007199254740993']) {
    assert.throws(() => resolveHealthPort({ ...CLOUD, NODE_APP_INSTANCE: value }), PortConfigError, JSON.stringify(value))
  }
})

test('malformed or out-of-range PORT / HEALTH_PORT are configuration errors', () => {
  for (const PORT of ['', 'abc', '0', '-5', '65536', '2567.0', ' 2567']) {
    assert.throws(() => resolveGamePort({ PORT }), PortConfigError, `PORT ${JSON.stringify(PORT)}`)
    assert.throws(() => resolveHealthPort({ PORT }), PortConfigError, `PORT ${JSON.stringify(PORT)} (health)`)
  }
  for (const HEALTH_PORT of ['', 'x', '0', '65536', '-1', '80.5']) {
    assert.throws(() => resolveHealthPort({ HEALTH_PORT }), PortConfigError, `HEALTH_PORT ${JSON.stringify(HEALTH_PORT)}`)
  }
  assert.equal(resolveHealthPort({ HEALTH_PORT: '1' }).port, 1)
  assert.equal(resolveHealthPort({ HEALTH_PORT: '65535' }).port, 65535)
})

test('overflow: PORT + 1 or base + slot above 65535 is a configuration error', () => {
  assert.throws(() => resolveHealthPort({ PORT: '65535' }), /PORT \+ 1/)
  assert.equal(resolveHealthPort({ PORT: '65535', HEALTH_PORT: '2568' }).port, 2568)
  assert.throws(() => resolveHealthPort({ ...CLOUD, HEALTH_PORT: '65535', NODE_APP_INSTANCE: '1' }), /base 65535 \+ NODE_APP_INSTANCE 1/)
  assert.equal(resolveHealthPort({ ...CLOUD, HEALTH_PORT: '65534', NODE_APP_INSTANCE: '1' }).port, 65535)
})
