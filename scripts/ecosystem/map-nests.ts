// ECO-MAP-1 · structured nest data derived from the proposals and the real
// geometry snapshot. Reproducible; writes nothing with --check.
//
//   node node_modules/vite-node/vite-node.mjs scripts/ecosystem/map-nests.ts            write docs/design/eco-map-1/nests.json
//   node node_modules/vite-node/vite-node.mjs scripts/ecosystem/map-nests.ts -- --check  exit 1 if missing or stale

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildNestData } from '../../src/features/ecosystem/map/nestData'

const OUTPUT = fileURLToPath(new URL('../../docs/design/eco-map-1/nests.json', import.meta.url))
const fresh = JSON.stringify(buildNestData(), null, 1) + '\n'

if (process.argv.includes('--check')) {
  let current: string | null = null
  try { current = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') } catch { current = null }
  if (current !== fresh) {
    console.error(`nests.json is ${current === null ? 'missing' : 'stale'}: run scripts/ecosystem/map-nests.ts`)
    process.exit(1)
  }
  console.log('nests.json is up to date')
} else {
  writeFileSync(OUTPUT, fresh)
  console.log(`wrote ${OUTPUT} (${fresh.length} bytes)`)
}
