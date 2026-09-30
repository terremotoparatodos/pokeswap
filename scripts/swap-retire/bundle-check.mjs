// SWAP RETIRE-2: proves a built bundle carries no working Swap.
//
//   npm run build && node scripts/swap-retire/bundle-check.mjs normal
//   VITE_PLAYTEST=on npm run build && node scripts/swap-retire/bundle-check.mjs playtest
//
// Both builds: no call to pokeswap-swap or skip_swap_cooldown, no Swap history
// or cooldown read, no Swap button copy, and Silph Co.'s retirement notice is
// there. Normal build: /swap's view is the static notice. Playtest build: no
// feature view ships at all, so neither does that one.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (mode !== 'normal' && mode !== 'playtest') {
  console.error('usage: bundle-check.mjs normal|playtest')
  process.exit(2)
}

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))

async function files(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await files(path)))
    else if (/\.(js|html|css)$/.test(entry.name)) out.push(path)
  }
  return out
}

const bundle = []
for (const path of await files(DIST)) bundle.push({ path, text: await readFile(path, 'utf8') })
const all = bundle.map(file => file.text).join('\n')

const FORBIDDEN = ['pokeswap-swap', 'skip_swap_cooldown', 'swap_history', 'swap_cooldown_until', '¡Hacer Swap!', 'Ir a Swap', 'Queda cerrado durante el playtest']
const NOTICE = 'El intercambio fue retirado. Próximamente este edificio albergará investigación de huevos e incubación.'

const failures = []
for (const needle of FORBIDDEN) {
  const hits = bundle.filter(file => file.text.includes(needle)).map(file => file.path)
  if (hits.length) failures.push(`${JSON.stringify(needle)} found in ${hits.join(', ')}`)
}
if (!all.includes(NOTICE)) failures.push('the retirement notice is missing')
const retiredView = all.includes('swap-retired-notice')
if (mode === 'normal' && !retiredView) failures.push('/swap does not ship the retired notice view')
if (mode === 'playtest' && retiredView) failures.push('the playtest build ships a feature view it must not register')

console.log(`[swap-retire] ${mode}: ${bundle.length} files scanned`)
if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log('  ✓ no pokeswap-swap, no skip_swap_cooldown, no Swap history/cooldown, no Swap button')
console.log(`  ✓ retirement notice present; retired view ${mode === 'normal' ? 'is /swap' : 'not shipped'}`)
