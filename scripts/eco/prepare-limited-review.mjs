import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Builds and archives only. No listener, launcher, env file, credentials or hosting API.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.argv[2]
assert.ok(output && isAbsolute(output), 'pass a new absolute output directory outside the worktree')
const out = resolve(output)
assert.ok(relative(root, out).startsWith('..'), 'output must stay outside the source worktree')
assert.ok(!existsSync(out), 'refuse to replace an existing review directory')
function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', ...options })
  assert.equal(result.status, 0, `${program} failed: ${result.stderr ?? result.error ?? ''}`)
  return result.stdout
}
const base = 'da3c782c80275889d997cdffbced4f7526d97c96'
const sha = run('git', ['rev-parse', 'HEAD']).trim()
run('git', ['merge-base', '--is-ancestor', base, sha])
assert.equal(run('git', ['status', '--porcelain']).trim(), '', 'freeze and commit the source before packaging')
mkdirSync(out, { recursive: true })
const env = { ...process.env, NODE_ENV: 'production' }
for (const name of Object.keys(env)) if (name.startsWith('VITE_')) delete env[name]
Object.assign(env, { VITE_BUILD_ID: sha, VITE_SUPABASE_URL: 'https://auth-scripted.invalid', VITE_SUPABASE_ANON_KEY: 'SCRIPTED-public-placeholder',
  VITE_REALTIME_URL: 'wss://realtime-scripted.invalid', VITE_ECO_EXPERIMENT: 'on', VITE_PERF: 'off', VITE_PRESENCE_BENCHMARK: 'off' })
const manifests = {}
for (const profile of ['normal', 'limited']) {
  const buildEnv = { ...env, VITE_ECO_RELEASE: profile === 'limited' ? 'limited' : '', VITE_PLAYTEST: profile === 'limited' ? 'on' : 'off' }
  const destination = join(out, profile)
  const log = run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--manifest', '--outDir', destination], { env: buildEnv })
  writeFileSync(join(out, `${profile}-build.log`), log)
  const manifest = JSON.parse(readFileSync(join(destination, '.vite/manifest.json'), 'utf8'))
  manifests[profile] = Object.keys(manifest)
  const keys = manifests[profile].join('\n')
  assert.doesNotMatch(keys, /EcoDevPanel|DevHelp|PerfPanel|SkillsWorldLayer|CityPanel|PlaytestShell|CityLabView|DungeonPrototypeView|SurfaceGallery/)
  if (profile === 'normal') {
    assert.doesNotMatch(keys, /EcoLimitedShell|EcoExperimentLayer/)
    assert.match(keys, /MarketView/)
  } else {
    assert.match(keys, /EcoLimitedShell/); assert.match(keys, /EcoExperimentLayer/)
    assert.doesNotMatch(keys, /MarketView|DungeonView|ProfileView|MyBoxView|PokedexView|SwapRetiredView/)
    const js = Object.values(manifest).filter(m => m.file.endsWith('.js')).map(m => readFileSync(join(destination, m.file), 'utf8')).join('\n')
    assert.doesNotMatch(js, /Retirar \(prueba\)|ECO · depuración \(dev\)|community-0\.1|community_0_1/)
    assert.ok(js.includes('auth-scripted.invalid') && js.includes('realtime-scripted.invalid'))
  }
  run('tar', ['-a', '-cf', join(out, `${profile}-client.zip`), '-C', destination, '.'])
}
run('git', ['archive', '--format=tar', `--output=${join(out, 'realtime-source.tar')}`, sha, 'services/realtime'])
run('git', ['bundle', 'create', join(out, 'review.bundle'), `${base}..HEAD`])
function files(directory) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
const hashes = Object.fromEntries(files(out).map(path => [relative(out, path).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(path)).digest('hex')]))
writeFileSync(join(out, 'review-manifest.json'), JSON.stringify({ label: 'SCRIPTED LOCAL REVIEW — NOT ACTIVATABLE', sha, base,
  node: process.version, configuration: 'Only .invalid public endpoints and SCRIPTED public placeholder. No hosted verification.',
  image: 'Existing Dockerfile packaged as source only; no container image built or started.', manifests, sha256: hashes }, null, 2) + '\n')
console.log(JSON.stringify({ sha, output: out, profileAssertions: 'passed', files: Object.keys(hashes).length }))
