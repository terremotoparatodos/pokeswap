// Run with: node --test "scripts/payment-retire/*.test.mjs"   (Node 22 does not take a directory)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertTargetProject,
  checkRemoteChange,
  checkRepo,
  deployCommand,
  EXTERNAL_PROJECT_REF,
  PRODUCTION_FUNCTION_IDS,
  PRODUCTION_PROJECT_REF,
  PUBLIC_RECEIVERS,
  verifyJwtDeclarations,
} from './webhook-deploy-guard.mjs'

const GUARD = fileURLToPath(new URL('./webhook-deploy-guard.mjs', import.meta.url))
const ROOT = resolve(dirname(GUARD), '..', '..')

/** A throwaway copy of supabase/functions, so a test can break it. */
function scratchRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'webhook-guard-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  cpSync(join(ROOT, 'supabase', 'functions'), join(dir, 'supabase', 'functions'), { recursive: true })
  return dir
}

test('this checkout passes: the five receivers are the retired versions', () => {
  assert.deepEqual(checkRepo(ROOT), [])
})

test('a checkout with the pre-retirement kofi-webhook fails (e.g. deploying from main)', t => {
  const dir = scratchRepo(t)
  const legacy = execFileSync('git', ['show', '9475138:supabase/functions/kofi-webhook/index.ts'], { cwd: ROOT, encoding: 'utf8' })
  writeFileSync(join(dir, 'supabase', 'functions', 'kofi-webhook', 'index.ts'), legacy)
  const problems = checkRepo(dir).join('\n')
  for (const expected of ['createClient', 'SERVICE_ROLE', 'swap_cooldown', 'must import only ./handler.ts']) {
    assert.ok(problems.includes(expected), `expected a problem mentioning ${expected}:\n${problems}`)
  }
})

test('a missing stub or a stub that reads the body fails', t => {
  const dir = scratchRepo(t)
  rmSync(join(dir, 'supabase', 'functions', 'webhook-stripe'), { recursive: true })
  writeFileSync(join(dir, 'supabase', 'functions', 'paypal-ipn', 'index.ts'),
    "import { handleRetiredPaymentWebhook } from '../_shared/retiredPaymentWebhook.ts'\nDeno.serve(async req => { await req.text(); return handleRetiredPaymentWebhook(req) })\n")
  const problems = checkRepo(dir).join('\n')
  assert.match(problems, /missing supabase\/functions\/webhook-stripe\/index\.ts/)
  assert.match(problems, /paypal-ipn\/index\.ts contains/)
})

test('config.toml: absent is fine; if present the five must be false, other functions are not judged', t => {
  const dir = scratchRepo(t)
  const config = join(dir, 'supabase', 'config.toml')
  const write = body => writeFileSync(config, body)

  write(PUBLIC_RECEIVERS.map(s => `[functions.${s}]\nverify_jwt = false\n`).join('\n') + '\n[functions.market-buy]\nverify_jwt = true # keeps auth\n')
  assert.deepEqual(checkRepo(dir), [])

  write('[functions.webhook-stripe]\nverify_jwt = true\n')
  assert.match(checkRepo(dir).join('\n'), /webhook-stripe must have verify_jwt = false/)

  // A function outside this task may legitimately be public (or not): not this guard's call.
  write('[functions.market-buy]\nverify_jwt = false\n[functions."world-authority"]\nverify_jwt=true\n')
  assert.deepEqual(checkRepo(dir), [])

  write('[edge_runtime]\nverify_jwt = false\n')
  assert.match(checkRepo(dir).join('\n'), /outside a \[functions\.<slug>\] section/)
})

test('verifyJwtDeclarations reads only [functions.<slug>] verify_jwt lines', () => {
  const found = verifyJwtDeclarations('project_id = "x"\n[functions.a]\nverify_jwt = false\nentrypoint = "./a.ts"\n[db]\nport = 1\n')
  assert.deepEqual([...found], [['a', 'false']])
})

test('deployCommand prints one single-function command per receiver, with --no-verify-jwt', () => {
  for (const slug of PUBLIC_RECEIVERS) {
    assert.equal(deployCommand(slug), `supabase functions deploy ${slug} --project-ref ${PRODUCTION_PROJECT_REF} --no-verify-jwt --use-api`)
  }
})

test('deployCommand refuses deploy-all, other functions and the external project', () => {
  assert.throws(() => deployCommand(undefined), /deploys every function/)
  assert.throws(() => deployCommand(''), /deploys every function/)
  for (const slug of ['market-buy', 'world-authority', 'pokeswap-swap', 'create-checkout', 'create-payment-skip']) {
    assert.throws(() => deployCommand(slug), /prints no command for it/)
  }
  assert.throws(() => deployCommand('kofi-webhook', EXTERNAL_PROJECT_REF), /external project/)
  assert.throws(() => deployCommand('kofi-webhook', 'abcdefghijklmnopqrst'), /not the production project/)
  assert.throws(() => deployCommand('kofi-webhook', 'not-a-ref; rm -rf /'), /not a Supabase project ref/)
})

// Inventories shaped like `supabase functions list --output json`. The five carry their
// real production ids; unrelated functions get made-up ones.
const fn = (slug, verify_jwt, extra = {}) => ({
  id: PRODUCTION_FUNCTION_IDS[slug] ?? `id-${slug}`, slug, name: slug, status: 'ACTIVE', version: 3, verify_jwt,
  ezbr_sha256: `sha-${slug}-v3`, updated_at: 1_790_000_000_000, entrypoint_path: `file:///src/${slug}/index.ts`, ...extra,
})
/** Hosted before the deploy: the three webhook-* behind a JWT, two unrelated public functions. */
const BEFORE = [
  fn('kofi-webhook', false, { version: 1 }), fn('paypal-ipn', false, { version: 1 }),
  fn('webhook-paypal', true, { version: 6 }), fn('webhook-stripe', true, { version: 13 }), fn('webhook-mercadopago', true, { version: 13 }),
  fn('market-buy', true), fn('world-authority', true),
  fn('verify-loyalty', false), fn('some-public-hook', false),
]
/** After a correct deploy: only the five moved (new version and hash, verify_jwt false). */
const AFTER = BEFORE.map(f => (PUBLIC_RECEIVERS.includes(f.slug)
  ? { ...f, verify_jwt: false, version: f.version + 1, ezbr_sha256: `sha-${f.slug}-retired`, updated_at: 1_790_000_900_000 }
  : { ...f }))
const edit = (list, slug, patch) => list.map(f => (f.slug === slug ? { ...f, ...patch } : f))

test('verify-remote: the five in false and everything else untouched passes', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER), [])
})

test('verify-remote: an unrelated function with verify_jwt=false before and after is valid', () => {
  assert.equal(BEFORE.find(f => f.slug === 'verify-loyalty').verify_jwt, false)
  assert.equal(AFTER.find(f => f.slug === 'verify-loyalty').verify_jwt, false)
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER), [])
})

test('verify-remote: does not assume the previous state was true', () => {
  const allPublic = BEFORE.map(f => ({ ...f, verify_jwt: false }))
  const after = allPublic.map(f => AFTER.find(a => a.slug === f.slug)).map(f => (PUBLIC_RECEIVERS.includes(f.slug) ? f : { ...f, verify_jwt: false }))
  assert.deepEqual(checkRemoteChange(allPublic, after), [])
})

test('verify-remote: an unrelated function going false → true fails', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'verify-loyalty', { verify_jwt: true })),
    ['verify-loyalty: verify_jwt changed from false to true'])
})

test('verify-remote: an unrelated function going true → false fails', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'market-buy', { verify_jwt: false })),
    ['market-buy: verify_jwt changed from true to false'])
})

test('verify-remote: deleting an unrelated function fails', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER.filter(f => f.slug !== 'world-authority')),
    ['world-authority: existed before and is gone'])
})

test('verify-remote: changing an unrelated function version, hash or metadata fails', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'market-buy', { version: 4 })), ['market-buy: version changed from 3 to 4'])
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'market-buy', { ezbr_sha256: 'sha-other' })),
    ['market-buy: ezbr_sha256 changed from "sha-market-buy-v3" to "sha-other"'])
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'some-public-hook', { updated_at: 1 })),
    ['some-public-hook: updated_at changed from 1790000000000 to 1'])
  const stripped = { ...AFTER.find(f => f.slug === 'market-buy') }
  delete stripped.ezbr_sha256
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER.map(f => (f.slug === 'market-buy' ? stripped : f))),
    ['market-buy: ezbr_sha256 was "sha-market-buy-v3", now missing'])
})

test('verify-remote: a new unrelated function appearing fails; only the five may change', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, [...AFTER, fn('create-checkout', true)]),
    ['create-checkout: appeared after the deploy; only the five may change'])
})

test('verify-remote: only the five may change version or hash', () => {
  for (const slug of PUBLIC_RECEIVERS) {
    const b = BEFORE.find(f => f.slug === slug)
    const a = AFTER.find(f => f.slug === slug)
    assert.notEqual(a.version, b.version)
    assert.notEqual(a.ezbr_sha256, b.ezbr_sha256)
  }
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER), [])
})

test('verify-remote: a target left with verify_jwt=true, or missing, fails', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'webhook-stripe', { verify_jwt: true })),
    ['webhook-stripe: verify_jwt is true, must be false'])
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER.filter(f => f.slug !== 'paypal-ipn')),
    ['after: paypal-ipn is missing; cannot confirm this is production'])
})

test('project identity: the five pinned ids are the production ones given for this task', () => {
  assert.deepEqual({ ...PRODUCTION_FUNCTION_IDS }, {
    'kofi-webhook': '9a59d5c8-cae3-4545-a8eb-257c19668a8b',
    'paypal-ipn': 'fab0ec1d-87cc-4d24-99ef-5dd55628a5b9',
    'webhook-paypal': '3be1f08d-9758-4d1c-98a8-d0cf78dee61d',
    'webhook-stripe': '46a7e11f-1767-4e90-9cfd-0eb38a0a8e2e',
    'webhook-mercadopago': 'c9db404c-339d-4eb0-a52a-096d8de4ffd5',
  })
  assert.deepEqual(Object.keys(PRODUCTION_FUNCTION_IDS).sort(), [...PUBLIC_RECEIVERS].sort())
  assert.ok(Object.isFrozen(PRODUCTION_FUNCTION_IDS))
})

test('project identity: the right ids in both inventories pass', () => {
  for (const slug of PUBLIC_RECEIVERS) {
    assert.equal(BEFORE.find(f => f.slug === slug).id, PRODUCTION_FUNCTION_IDS[slug])
    assert.equal(AFTER.find(f => f.slug === slug).id, PRODUCTION_FUNCTION_IDS[slug])
  }
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER), [])
})

test('project identity: a wrong id in before fails', () => {
  const wrong = '00000000-0000-4000-8000-000000000000'
  assert.deepEqual(checkRemoteChange(edit(BEFORE, 'webhook-stripe', { id: wrong }), AFTER),
    [`before: webhook-stripe has id ${wrong}, production is ${PRODUCTION_FUNCTION_IDS['webhook-stripe']}; not the production project`])
})

test('project identity: a wrong id in after fails', () => {
  const wrong = '00000000-0000-4000-8000-000000000000'
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'kofi-webhook', { id: wrong })),
    [`after: kofi-webhook has id ${wrong}, production is ${PRODUCTION_FUNCTION_IDS['kofi-webhook']}; not the production project`])
})

test('project identity: a missing id fails', () => {
  const stripped = { ...AFTER.find(f => f.slug === 'paypal-ipn') }
  delete stripped.id
  assert.deepEqual(checkRemoteChange(BEFORE, AFTER.map(f => (f.slug === 'paypal-ipn' ? stripped : f))),
    [`after: paypal-ipn has id undefined, production is ${PRODUCTION_FUNCTION_IDS['paypal-ipn']}; not the production project`])
})

test('project identity: swapping ids between two slugs fails, in either inventory', () => {
  const swap = list => list.map(f => {
    if (f.slug === 'webhook-paypal') return { ...f, id: PRODUCTION_FUNCTION_IDS['webhook-stripe'] }
    if (f.slug === 'webhook-stripe') return { ...f, id: PRODUCTION_FUNCTION_IDS['webhook-paypal'] }
    return f
  })
  for (const [before, after, label] of [[swap(BEFORE), AFTER, 'before'], [BEFORE, swap(AFTER), 'after']]) {
    const problems = checkRemoteChange(before, after)
    assert.equal(problems.length, 2, problems.join('\n'))
    assert.match(problems.join('\n'), new RegExp(`${label}: webhook-paypal has id ${PRODUCTION_FUNCTION_IDS['webhook-stripe']}`))
    assert.match(problems.join('\n'), new RegExp(`${label}: webhook-stripe has id ${PRODUCTION_FUNCTION_IDS['webhook-paypal']}`))
  }
})

test('project identity: coherent inventories of another project fail', () => {
  // Same shape, internally consistent before/after, but every id belongs to another project.
  const other = list => list.map(f => ({ ...f, id: `other-${f.slug}` }))
  const problems = checkRemoteChange(other(BEFORE), other(AFTER))
  assert.equal(problems.length, 2 * PUBLIC_RECEIVERS.length, problems.join('\n'))
  for (const slug of PUBLIC_RECEIVERS) {
    for (const label of ['before', 'after']) {
      assert.ok(problems.includes(`${label}: ${slug} has id other-${slug}, production is ${PRODUCTION_FUNCTION_IDS[slug]}; not the production project`))
    }
  }
})

test('verify-remote: an unrelated function whose id changes fails (mixed dumps)', () => {
  assert.deepEqual(checkRemoteChange(BEFORE, edit(AFTER, 'market-buy', { id: 'id-elsewhere' })),
    ['market-buy: id changed from "id-market-buy" to "id-elsewhere"'])
})

test('verify-remote: malformed inventories fail', () => {
  assert.match(checkRemoteChange({}, AFTER).join('\n'), /before: expected the JSON array/)
  assert.match(checkRemoteChange(BEFORE, null).join('\n'), /after: expected the JSON array/)
  assert.match(checkRemoteChange(BEFORE, [...AFTER, AFTER[0]]).join('\n'), /after: kofi-webhook appears twice/)
  assert.match(checkRemoteChange([{ version: 1 }], AFTER).join('\n'), /before: an entry has no slug/)
})

test('only the production project is a valid target', () => {
  assert.doesNotThrow(() => assertTargetProject(PRODUCTION_PROJECT_REF))
  assert.throws(() => assertTargetProject(EXTERNAL_PROJECT_REF), /external project/)
  assert.throws(() => assertTargetProject('abcdefghijklmnopqrst'), /not the production project/)
  assert.throws(() => assertTargetProject(undefined), /not a Supabase project ref/)
})

test('CLI: exit codes', t => {
  const run = (...args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' })
  assert.equal(run('check').status, 0)
  const ok = run('command', 'kofi-webhook')
  assert.equal(ok.status, 0)
  assert.equal(ok.stdout.trim(), deployCommand('kofi-webhook'))
  assert.equal(run('command').status, 1)
  assert.equal(run('command', 'market-buy').status, 1)
  assert.equal(run('command', 'paypal-ipn', '--project-ref', EXTERNAL_PROJECT_REF).status, 1)
  assert.equal(run('nonsense').status, 1)

  const dir = mkdtempSync(join(tmpdir(), 'webhook-guard-list-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const before = join(dir, 'before.json')
  const after = join(dir, 'after.json')
  writeFileSync(before, JSON.stringify(BEFORE))
  writeFileSync(after, JSON.stringify(AFTER))
  const ref = ['--project-ref', PRODUCTION_PROJECT_REF]
  assert.equal(run('verify-remote', before, after, ...ref).status, 0)
  assert.equal(run('verify-remote', before, after).status, 1, 'project ref is required')
  assert.equal(run('verify-remote', before, after, '--project-ref', EXTERNAL_PROJECT_REF).status, 1)
  assert.equal(run('verify-remote', before, after, '--project-ref', 'abcdefghijklmnopqrst').status, 1)
  assert.equal(run('verify-remote', after, ...ref).status, 1, 'both inventories are required')
  assert.equal(run('verify-remote', ...ref).status, 1)
  assert.equal(run('verify-remote', join(dir, 'missing.json'), after, ...ref).status, 1)
  writeFileSync(after, JSON.stringify(edit(AFTER, 'verify-loyalty', { verify_jwt: true })))
  const changed = run('verify-remote', before, after, ...ref)
  assert.equal(changed.status, 1)
  assert.match(changed.stderr, /verify-loyalty: verify_jwt changed from false to true/)
})
