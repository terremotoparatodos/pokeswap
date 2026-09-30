#!/usr/bin/env node
// PAYMENTS RETIRE-2 — deploy guard for the five public payment receivers.
//
// These five must run with verify_jwt = false (Ko-fi, PayPal, Stripe and
// MercadoPago cannot send a Supabase JWT). Every other function must keep
// verify_jwt = true. There is no per-function config file in Supabase: the only
// versioned place is the project-wide supabase/config.toml, which this repo does
// not have and this task does not add (it is also read by `start`, `db push`,
// `link` and `config push`). So the setting travels as an explicit
// `--no-verify-jwt` flag on a single-function deploy, and this guard:
//
//   check                      the five sources are the retired versions, and any
//                              supabase/config.toml declares verify_jwt correctly
//   command <slug> [--project-ref <ref>]
//                              runs `check`, then prints the only deploy command for
//                              that slug. Refuses other slugs, "deploy all", and
//                              the external project.
//   verify-remote <list.json>  reads `supabase functions list --output json` and
//                              fails unless the five have verify_jwt = false and
//                              every other function has verify_jwt = true
//
// It never runs the Supabase CLI, never deploys and needs no credentials.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCTION_PROJECT_REF = 'qsufableozmyugcrhcai'
/** Legacy PayPal buttons pointed IPN here. Not ours to administer: never deploy to it. */
export const EXTERNAL_PROJECT_REF = 'xdhtasxadmhjltmtirxy'

export const KOFI_RECEIVER = 'kofi-webhook'
export const RETIRED_STUBS = ['paypal-ipn', 'webhook-paypal', 'webhook-stripe', 'webhook-mercadopago']
export const PUBLIC_RECEIVERS = [KOFI_RECEIVER, ...RETIRED_STUBS]

const SHARED_STUB = '../_shared/retiredPaymentWebhook.ts'

const FORBIDDEN_IN_ANY_RECEIVER = [
  /@supabase|supabase-js|createClient/,
  /SERVICE_ROLE|service_role/i,
  /\.from\(|\.rpc\(|\.(insert|update|upsert|delete|select)\(/,
  /auth\.admin|listUsers/,
  /\bfetch\(|Deno\.connect/,
  /\bprofiles\b|swap_cooldown|kofi_payments|token_ledger|\btransactions\b|confirm_payment/,
]
const FORBIDDEN_IN_STUB = [/Deno\.env/, /\.(json|text|formData|arrayBuffer|blob|bytes)\(\)|\.body\b/, /console\./]

const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const importsOf = code => [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), ...code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)].map(m => m[1])
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * `[functions.<slug>] verify_jwt = <bool>` pairs from a config.toml. Deliberately
 * narrow: it reads only those two line shapes, which is all this guard needs.
 */
export function verifyJwtDeclarations(toml) {
  const out = new Map()
  let section = null
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const header = line.match(/^\[\s*([^\]]+?)\s*\]$/)
    if (header) { section = header[1]; continue }
    const setting = line.match(/^verify_jwt\s*=\s*(\S+)$/)
    if (!setting) continue
    const fn = section?.match(/^functions\.("?)([A-Za-z0-9_-]+)\1$/)
    out.set(fn ? fn[2] : `[${section ?? 'top level'}]`, setting[1])
  }
  return out
}

/** Problems with the working tree. Empty means safe to print a deploy command. */
export function checkRepo(root) {
  const problems = []
  const functions = join(root, 'supabase', 'functions')
  const read = rel => {
    const file = join(functions, rel)
    if (!existsSync(file)) { problems.push(`missing supabase/functions/${rel}`); return null }
    return stripComments(readFileSync(file, 'utf8'))
  }
  const scan = (rel, code, rules) => {
    for (const rule of rules) if (rule.test(code)) problems.push(`${rel} contains ${rule}`)
  }

  const kofiIndex = read(`${KOFI_RECEIVER}/index.ts`)
  const kofiHandler = read(`${KOFI_RECEIVER}/handler.ts`)
  if (kofiIndex !== null) {
    scan(`${KOFI_RECEIVER}/index.ts`, kofiIndex, FORBIDDEN_IN_ANY_RECEIVER)
    if (!sameList(importsOf(kofiIndex), ['./handler.ts'])) problems.push(`${KOFI_RECEIVER}/index.ts must import only ./handler.ts`)
    const envReads = [...kofiIndex.matchAll(/Deno\.env\.\w+\(([^)]*)\)/g)].map(m => m[1])
    if (!sameList(envReads, ["'KOFI_VERIFICATION_TOKEN'"])) problems.push(`${KOFI_RECEIVER}/index.ts may read only KOFI_VERIFICATION_TOKEN`)
  }
  if (kofiHandler !== null) {
    scan(`${KOFI_RECEIVER}/handler.ts`, kofiHandler, FORBIDDEN_IN_ANY_RECEIVER)
    if (importsOf(kofiHandler).length) problems.push(`${KOFI_RECEIVER}/handler.ts must not import anything`)
  }

  const shared = read('_shared/retiredPaymentWebhook.ts')
  if (shared !== null) {
    scan('_shared/retiredPaymentWebhook.ts', shared, [...FORBIDDEN_IN_ANY_RECEIVER, ...FORBIDDEN_IN_STUB])
    if (importsOf(shared).length) problems.push('_shared/retiredPaymentWebhook.ts must not import anything')
  }
  for (const slug of RETIRED_STUBS) {
    const index = read(`${slug}/index.ts`)
    if (index === null) continue
    scan(`${slug}/index.ts`, index, [...FORBIDDEN_IN_ANY_RECEIVER, ...FORBIDDEN_IN_STUB])
    if (!sameList(importsOf(index), [SHARED_STUB])) problems.push(`${slug}/index.ts must import only ${SHARED_STUB}`)
  }

  const configPath = join(root, 'supabase', 'config.toml')
  if (existsSync(configPath)) {
    for (const [name, value] of verifyJwtDeclarations(readFileSync(configPath, 'utf8'))) {
      if (name.startsWith('[')) problems.push(`supabase/config.toml sets verify_jwt outside a [functions.<slug>] section (${name})`)
      else if (PUBLIC_RECEIVERS.includes(name) && value !== 'false') problems.push(`supabase/config.toml: ${name} must have verify_jwt = false, found ${value}`)
      else if (!PUBLIC_RECEIVERS.includes(name) && value !== 'true') problems.push(`supabase/config.toml: ${name} is not a public receiver and must keep verify_jwt = true, found ${value}`)
    }
  }
  return problems
}

export function deployCommand(slug, projectRef = PRODUCTION_PROJECT_REF) {
  if (!slug) throw new Error('name one function: deploying without a slug deploys every function in supabase/functions')
  if (!PUBLIC_RECEIVERS.includes(slug)) {
    throw new Error(`${slug} is not one of the public payment receivers (${PUBLIC_RECEIVERS.join(', ')}); never deploy it with --no-verify-jwt`)
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error(`not a Supabase project ref: ${projectRef}`)
  if (projectRef === EXTERNAL_PROJECT_REF) throw new Error(`${EXTERNAL_PROJECT_REF} is an external project we do not administer`)
  return `supabase functions deploy ${slug} --project-ref ${projectRef} --no-verify-jwt --use-api`
}

/** Problems with a `supabase functions list --output json` dump. Empty means hosted JWT config is right. */
export function checkRemoteList(list) {
  if (!Array.isArray(list)) return ['expected the JSON array printed by `supabase functions list --output json`']
  const problems = []
  const bySlug = new Map(list.map(f => [f.slug, f]))
  for (const slug of PUBLIC_RECEIVERS) {
    const fn = bySlug.get(slug)
    if (!fn) problems.push(`${slug}: not deployed`)
    else if (fn.verify_jwt !== false) problems.push(`${slug}: verify_jwt is ${fn.verify_jwt}, must be false`)
  }
  for (const fn of list) {
    if (!PUBLIC_RECEIVERS.includes(fn.slug) && fn.verify_jwt !== true) {
      problems.push(`${fn.slug}: verify_jwt is ${fn.verify_jwt}, must be true (not a public receiver)`)
    }
  }
  return problems
}

function main(argv, root) {
  const [cmd, ...rest] = argv
  const fail = lines => { for (const l of [].concat(lines)) console.error(`✗ ${l}`); return 1 }

  if (cmd === 'check') {
    const problems = checkRepo(root)
    if (problems.length) return fail(problems)
    console.log(`✓ ${PUBLIC_RECEIVERS.length} public receivers are the retired versions; verify_jwt declarations are consistent`)
    return 0
  }
  if (cmd === 'command') {
    const refAt = rest.indexOf('--project-ref')
    const ref = refAt >= 0 ? rest[refAt + 1] : PRODUCTION_PROJECT_REF
    const slug = rest.find((a, i) => !a.startsWith('--') && (refAt < 0 || i !== refAt + 1))
    const problems = checkRepo(root)
    if (problems.length) return fail(['refusing to print a deploy command:', ...problems])
    try {
      console.log(deployCommand(slug, ref))
      return 0
    } catch (err) {
      return fail(err.message)
    }
  }
  if (cmd === 'verify-remote') {
    if (!rest[0]) return fail('usage: verify-remote <functions-list.json>')
    let list
    try { list = JSON.parse(readFileSync(resolve(rest[0]), 'utf8')) } catch (err) { return fail(`cannot read ${rest[0]}: ${err.message}`) }
    const problems = checkRemoteList(list)
    if (problems.length) return fail(problems)
    console.log('✓ hosted verify_jwt matches: the five receivers are public, everything else requires a JWT')
    return 0
  }
  return fail('usage: webhook-deploy-guard.mjs check | command <slug> [--project-ref <ref>] | verify-remote <functions-list.json>')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'))
}
