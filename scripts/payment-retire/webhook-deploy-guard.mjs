#!/usr/bin/env node
// PAYMENTS RETIRE-2 — deploy guard for the five public payment receivers.
//
// These five must run with verify_jwt = false (Ko-fi, PayPal, Stripe and
// MercadoPago cannot send a Supabase JWT). Every other function is outside this
// task: the guard never assumes what its verify_jwt should be, it only checks
// that the deploy left it exactly as it was.
//
// There is no per-function config file in Supabase: the only
// versioned place is the project-wide supabase/config.toml, which this repo does
// not have and this task does not add (it is also read by `start`, `db push`,
// `link` and `config push`). So the setting travels as an explicit
// `--no-verify-jwt` flag on a single-function deploy, and this guard:
//
//   check                      the five sources are the retired versions, and
//                              supabase/config.toml, if any, declares nothing but
//                              verify_jwt = false for the five
//   command <slug> [--project-ref <ref>]
//                              runs `check`, then prints the only deploy command for
//                              that slug. Refuses other slugs, "deploy all", other
//                              projects and the external one.
//   verify-remote <before.json> <after.json> --project-ref <ref>
//                              compares two `supabase functions list --output json`
//                              dumps taken right before and right after the deploy:
//                              the five exist in both with their pinned production
//                              ids, and with verify_jwt = false after; every other
//                              function is unchanged (present, same verify_jwt, same
//                              version/hash/metadata), with nothing added
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

/**
 * Function ids of the five in production. They are public identifiers, not secrets,
 * and they survive a redeploy (only version and hash change). A dump whose five ids
 * are not these is not production, whatever it claims.
 */
export const PRODUCTION_FUNCTION_IDS = Object.freeze({
  'kofi-webhook': '9a59d5c8-cae3-4545-a8eb-257c19668a8b',
  'paypal-ipn': 'fab0ec1d-87cc-4d24-99ef-5dd55628a5b9',
  'webhook-paypal': '3be1f08d-9758-4d1c-98a8-d0cf78dee61d',
  'webhook-stripe': '46a7e11f-1767-4e90-9cfd-0eb38a0a8e2e',
  'webhook-mercadopago': 'c9db404c-339d-4eb0-a52a-096d8de4ffd5',
})

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
      // Any other function owns its setting; this task does not judge it.
    }
  }
  return problems
}

export function deployCommand(slug, projectRef = PRODUCTION_PROJECT_REF) {
  if (!slug) throw new Error('name one function: deploying without a slug deploys every function in supabase/functions')
  if (!PUBLIC_RECEIVERS.includes(slug)) {
    throw new Error(`${slug} is not one of the public payment receivers (${PUBLIC_RECEIVERS.join(', ')}); this guard prints no command for it`)
  }
  assertTargetProject(projectRef)
  return `supabase functions deploy ${slug} --project-ref ${projectRef} --no-verify-jwt --use-api`
}

/** Only production is a valid target; the external project gets its own message. */
export function assertTargetProject(projectRef) {
  if (typeof projectRef !== 'string' || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error(`not a Supabase project ref: ${projectRef}`)
  if (projectRef === EXTERNAL_PROJECT_REF) throw new Error(`${EXTERNAL_PROJECT_REF} is an external project we do not administer`)
  if (projectRef !== PRODUCTION_PROJECT_REF) throw new Error(`${projectRef} is not the production project ${PRODUCTION_PROJECT_REF}`)
}

/**
 * Metadata that must not move on a function outside the five. A field is compared
 * only when the `before` dump has it; then `after` must carry the same value.
 * `id` is per project, so it also catches two dumps taken from different projects.
 */
export const PRESERVED_FIELDS = [
  'id', 'verify_jwt', 'version', 'ezbr_sha256', 'status', 'updated_at',
  'entrypoint_path', 'import_map', 'import_map_path',
]

function indexBySlug(list, label, problems) {
  if (!Array.isArray(list)) {
    problems.push(`${label}: expected the JSON array printed by \`supabase functions list --output json\``)
    return null
  }
  const map = new Map()
  for (const fn of list) {
    if (!fn || typeof fn.slug !== 'string') { problems.push(`${label}: an entry has no slug`); continue }
    if (map.has(fn.slug)) problems.push(`${label}: ${fn.slug} appears twice`)
    map.set(fn.slug, fn)
  }
  return map
}

/**
 * Problems between the inventory taken right before the deploy and the one taken
 * right after. Empty means: the five are public, and nothing else was touched.
 * It never assumes what a non-target function's verify_jwt should be.
 */
export function checkRemoteChange(before, after) {
  const problems = []
  const was = indexBySlug(before, 'before', problems)
  const now = indexBySlug(after, 'after', problems)
  if (!was || !now) return problems

  // Project identity: both dumps must carry the five production ids. Versions and
  // hashes of the five are not pinned: the deploy changes them.
  for (const [label, map] of [['before', was], ['after', now]]) {
    for (const slug of PUBLIC_RECEIVERS) {
      const fn = map.get(slug)
      const expected = PRODUCTION_FUNCTION_IDS[slug]
      if (!fn) problems.push(`${label}: ${slug} is missing; cannot confirm this is production`)
      else if (fn.id !== expected) problems.push(`${label}: ${slug} has id ${fn.id}, production is ${expected}; not the production project`)
    }
  }

  for (const slug of PUBLIC_RECEIVERS) {
    const fn = now.get(slug)
    if (fn && fn.verify_jwt !== false) problems.push(`${slug}: verify_jwt is ${fn.verify_jwt}, must be false`)
  }

  for (const [slug, old] of was) {
    if (PUBLIC_RECEIVERS.includes(slug)) continue
    const fn = now.get(slug)
    if (!fn) { problems.push(`${slug}: existed before and is gone`); continue }
    for (const field of PRESERVED_FIELDS) {
      if (!Object.hasOwn(old, field)) continue
      if (!Object.hasOwn(fn, field)) problems.push(`${slug}: ${field} was ${JSON.stringify(old[field])}, now missing`)
      else if (JSON.stringify(fn[field]) !== JSON.stringify(old[field])) {
        problems.push(`${slug}: ${field} changed from ${JSON.stringify(old[field])} to ${JSON.stringify(fn[field])}`)
      }
    }
  }
  for (const slug of now.keys()) {
    if (!PUBLIC_RECEIVERS.includes(slug) && !was.has(slug)) problems.push(`${slug}: appeared after the deploy; only the five may change`)
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
    const refAt = rest.indexOf('--project-ref')
    const files = rest.filter((arg, i) => !arg.startsWith('--') && (refAt < 0 || i !== refAt + 1))
    if (files.length !== 2) return fail('usage: verify-remote <before.json> <after.json> --project-ref <ref> (both inventories are required)')
    if (refAt < 0) return fail(`--project-ref is required and must be ${PRODUCTION_PROJECT_REF}`)
    try { assertTargetProject(rest[refAt + 1]) } catch (err) { return fail(err.message) }
    const lists = []
    for (const file of files) {
      try { lists.push(JSON.parse(readFileSync(resolve(file), 'utf8'))) } catch (err) { return fail(`cannot read ${file}: ${err.message}`) }
    }
    const problems = checkRemoteChange(lists[0], lists[1])
    if (problems.length) return fail(problems)
    console.log('✓ the five receivers are public; every other function is exactly as it was before the deploy')
    return 0
  }
  return fail('usage: webhook-deploy-guard.mjs check | command <slug> [--project-ref <ref>] | verify-remote <before.json> <after.json> --project-ref <ref>')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'))
}
