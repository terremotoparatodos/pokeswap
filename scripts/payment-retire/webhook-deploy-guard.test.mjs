// Run with: node --test scripts/payment-retire/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkRemoteList,
  checkRepo,
  deployCommand,
  EXTERNAL_PROJECT_REF,
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

test('config.toml: absent is fine; if present it must match the five and nothing else', t => {
  const dir = scratchRepo(t)
  const config = join(dir, 'supabase', 'config.toml')
  const write = body => writeFileSync(config, body)

  write(PUBLIC_RECEIVERS.map(s => `[functions.${s}]\nverify_jwt = false\n`).join('\n') + '\n[functions.market-buy]\nverify_jwt = true # keeps auth\n')
  assert.deepEqual(checkRepo(dir), [])

  write('[functions.webhook-stripe]\nverify_jwt = true\n')
  assert.match(checkRepo(dir).join('\n'), /webhook-stripe must have verify_jwt = false/)

  write('[functions.market-buy]\nverify_jwt = false\n')
  assert.match(checkRepo(dir).join('\n'), /market-buy is not a public receiver/)

  write('[functions."world-authority"]\nverify_jwt=false\n')
  assert.match(checkRepo(dir).join('\n'), /world-authority is not a public receiver/)

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
    assert.throws(() => deployCommand(slug), /never deploy it with --no-verify-jwt/)
  }
  assert.throws(() => deployCommand('kofi-webhook', EXTERNAL_PROJECT_REF), /external project/)
  assert.throws(() => deployCommand('kofi-webhook', 'not-a-ref; rm -rf /'), /not a Supabase project ref/)
})

test('checkRemoteList accepts only: the five public, everything else behind a JWT', () => {
  const good = [
    ...PUBLIC_RECEIVERS.map(slug => ({ slug, verify_jwt: false, version: 2 })),
    { slug: 'market-buy', verify_jwt: true }, { slug: 'pokeswap-swap', verify_jwt: true },
  ]
  assert.deepEqual(checkRemoteList(good), [])

  const stripeLocked = good.map(f => (f.slug === 'webhook-stripe' ? { ...f, verify_jwt: true } : f))
  assert.deepEqual(checkRemoteList(stripeLocked), ['webhook-stripe: verify_jwt is true, must be false'])

  const marketOpen = good.map(f => (f.slug === 'market-buy' ? { ...f, verify_jwt: false } : f))
  assert.deepEqual(checkRemoteList(marketOpen), ['market-buy: verify_jwt is false, must be true (not a public receiver)'])

  assert.deepEqual(checkRemoteList(good.filter(f => f.slug !== 'paypal-ipn')), ['paypal-ipn: not deployed'])
  assert.equal(checkRemoteList({}).length, 1)
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
  const list = join(dir, 'list.json')
  writeFileSync(list, JSON.stringify(PUBLIC_RECEIVERS.map(slug => ({ slug, verify_jwt: false }))))
  assert.equal(run('verify-remote', list).status, 0)
  writeFileSync(list, JSON.stringify([{ slug: 'kofi-webhook', verify_jwt: true }]))
  assert.equal(run('verify-remote', list).status, 1)
})
