import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { limitedRelease } from '../../services/realtime/src/security/limitedRelease.js'

// L-R1: fictitious shape fixtures only. Real Vite builds, no services or network calls.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.argv[2]
assert.ok(output && isAbsolute(output), 'pass a new absolute evidence directory outside the worktree')
const out = resolve(output)
assert.ok(relative(root, out).startsWith('..') && !existsSync(out), 'refuse an existing directory or source-tree output')
mkdirSync(out, { recursive: true })
const jwt = role => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ role, ref: 'SCRIPTED_NOT_REAL', exp: 4070908800 })).toString('base64url'), 'SCRIPTED_FAKE_SIGNATURE'].join('.')
const fixtures = [
  { kind: 'private-prefix', key: 'sb_secret_' + 'A'.repeat(32), reject: true },
  { kind: 'service-role', key: jwt('service_role'), reject: true },
  { kind: 'publishable', key: 'sb_publishable_SCRIPTED_NOT_REAL', reject: false },
  { kind: 'anon', key: jwt('anon'), reject: false },
]
const safeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT'].includes(name.toUpperCase())))
const server = { NODE_ENV: 'production', WORLD_ECO_RELEASE: 'limited', WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned',
  WORLD_ECO_TESTER_IDS: '11111111-1111-4111-8111-111111111111', WORLD_ECO_EXPIRES_AT: '2099-01-01T00:00:00Z', ALLOWED_ORIGINS: 'https://eco-scripted.invalid',
  SUPABASE_URL: 'https://auth-scripted.invalid', WORLD_AUTHORITY_URL: 'https://edge-scripted.invalid', WORLD_AUTHORITY_SECRET: 'SCRIPTED-only-'.repeat(4) }
const results = []
for (const fixture of fixtures) {
  let serverRejected = false
  try { limitedRelease({ ...server, SUPABASE_PUBLISHABLE_KEY: fixture.key }) } catch { serverRejected = true }
  assert.equal(serverRejected, fixture.reject, `${fixture.kind}: server classification`)
  for (const profile of ['normal', 'limited']) {
    const destination = join(out, `${profile}-${fixture.kind}`)
    const env = { ...safeEnvironment, NODE_ENV: 'production', VITE_SUPABASE_URL: 'https://auth-scripted.invalid', VITE_SUPABASE_ANON_KEY: fixture.key,
      VITE_REALTIME_URL: 'wss://realtime-scripted.invalid', VITE_ECO_EXPERIMENT: 'on', VITE_ECO_RELEASE: profile === 'limited' ? 'limited' : '',
      VITE_PLAYTEST: profile === 'limited' ? 'on' : 'off', VITE_PERF: 'off', VITE_PRESENCE_BENCHMARK: 'off' }
    const build = spawnSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--manifest', '--outDir', destination], { cwd: root, env, encoding: 'utf8', windowsHide: true })
    const log = (build.stdout ?? '') + (build.stderr ?? '')
    // Never store a rejected credential, even a fixture, in diagnostics.
    if (fixture.reject) assert.ok(!log.includes(fixture.key), `${fixture.kind}: diagnostic privacy`)
    const safeLog = log.replaceAll(fixture.key, '[REDACTED]')
    writeFileSync(join(out, `${profile}-${fixture.kind}.log`), safeLog)
    const producedClient = existsSync(destination)
    if (fixture.reject) {
      assert.notEqual(build.status, 0, `${fixture.kind}: build must reject`)
      assert.equal(producedClient, false, `${fixture.kind}: rejection must precede output creation`)
      assert.match(log, /public configuration: VITE_SUPABASE_ANON_KEY/)
      assert.doesNotMatch(log, /modules transformed/)
    } else {
      assert.equal(build.status, 0, `${fixture.kind}: public build succeeds`)
      const manifest = readFileSync(join(destination, '.vite/manifest.json'), 'utf8')
      if (profile === 'normal') assert.doesNotMatch(manifest, /EcoLimitedShell|EcoExperimentLayer/)
      else {
        assert.match(manifest, /EcoLimitedShell/)
        assert.doesNotMatch(manifest, /MarketView|DungeonView|ProfileView|MyBoxView|PlaytestShell|SkillsWorldLayer|EcoDevPanel|PerfPanel|DevHelp/)
      }
    }
    results.push({ kind: fixture.kind, profile, buildExit: build.status, serverRejected, producedClient, diagnosticValuePresent: false, pass: true })
  }
}
writeFileSync(join(out, 'public-credentials-results.json'), JSON.stringify({ label: 'SCRIPTED LOCAL L-R1 — no real credentials or Auth/Edge calls', node: process.version, results }, null, 2) + '\n')
console.log(JSON.stringify({ cases: results.length, passed: results.every(r => r.pass), outputs: readdirSync(out).length }))
