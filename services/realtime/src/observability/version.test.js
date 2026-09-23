import test from 'node:test'
import assert from 'node:assert/strict'
import { PRESENCE_PROTOCOL_REVISION, resolveBuildCommit, versionInfo } from './version.js'

test('build commit prefers an explicit env value and shortens it', () => {
  assert.equal(resolveBuildCommit({ PRESENCE_BUILD_COMMIT: '26F3B7C428A00769B82A8F0EEA1336371AE3A80C' }, () => 'ignored'), '26f3b7c')
})

test('build commit falls back to git, then to unknown, and never echoes arbitrary env text', () => {
  assert.equal(resolveBuildCommit({}, () => 'cba10e69703cf3efd0dce35e4d1d497b043557e1\n'), 'cba10e6')
  assert.equal(resolveBuildCommit({ PRESENCE_BUILD_COMMIT: 'eyJhbGciOi.secret' }, () => { throw new Error('no git') }), 'unknown')
  assert.equal(resolveBuildCommit({}, () => 'not a sha'), 'unknown')
})

test('version payload is limited to public build identity', () => {
  const info = versionInfo({ commit: 'abc1234', startedAt: '2026-09-23T00:00:00.000Z' })
  assert.deepEqual(Object.keys(info).sort(), ['commit', 'protocol', 'service', 'startedAt'])
  assert.equal(info.protocol, PRESENCE_PROTOCOL_REVISION)
})

test('the public entrypoint serves /version and keeps metrics off the public port', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(source, /app\.get\('\/version'/)
  assert.doesNotMatch(source, /app\.get\('\/metrics'/)
})
