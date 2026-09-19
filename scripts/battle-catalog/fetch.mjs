// Step 1 of the Battle Catalog pipeline (R32.1): cache the source tables.
//
//   node scripts/battle-catalog/fetch.mjs
//
// Downloads the files listed in `sources.json` at their pinned commit into
// `node_modules/.cache/battle-catalog` (git-ignored) and writes a manifest with
// the sha256 of each one. Nothing here lands in the repository: the build step
// reads this cache and emits PokeSwap's own catalog.
//
// Re-running is cheap and idempotent — a file whose hash already matches the
// manifest is left alone unless `--force` is passed.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const CACHE_DIR = join(here, '..', '..', 'node_modules', '.cache', 'battle-catalog')
const MANIFEST = join(CACHE_DIR, 'manifest.json')

const sha256 = text => createHash('sha256').update(text).digest('hex')

/**
 * A source file's name in the cache.
 *
 * A listed file may be a path inside its repository (`data/mods/gen6/moves.ts`)
 * and two of them share a basename, so the path is flattened rather than
 * truncated — otherwise the Gen VI diff would quietly overwrite the file it is
 * a diff of.
 */
export const cacheName = path => path.replace(/[\\/]/g, '__')

export async function loadSources() {
  return JSON.parse(await readFile(join(here, 'sources.json'), 'utf8'))
}

export async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const force = process.argv.includes('--force')
  const sources = await loadSources()
  // Every source that ships files: the tabular tables, and the pinned Gen VI
  // diff that corrects what those tables record at today's values.
  const downloads = sources.sources.filter(entry => entry.rawBase && entry.files)
  await mkdir(CACHE_DIR, { recursive: true })

  const previous = (await readManifest())?.files ?? {}
  const files = {}
  for (const { rawBase, files: names } of downloads) for (const path of names) {
    const name = cacheName(path)
    const target = join(CACHE_DIR, name)
    if (!force && previous[name]) {
      try {
        const cached = await readFile(target, 'utf8')
        if (sha256(cached) === previous[name].sha256) {
          files[name] = previous[name]
          process.stdout.write(`· ${name} (cached)\n`)
          continue
        }
      } catch { /* fall through and download */ }
    }
    const response = await fetch(`${rawBase}/${path}`)
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    const text = await response.text()
    await writeFile(target, text)
    files[name] = { bytes: Buffer.byteLength(text), sha256: sha256(text) }
    process.stdout.write(`↓ ${name} (${files[name].bytes} B)\n`)
  }

  await writeFile(MANIFEST, `${JSON.stringify({
    sources: downloads.map(({ id, repo, commit, license }) => ({ id, repo, commit, license })),
    fetchedAt: new Date().toISOString(),
    files,
  }, null, 2)}\n`)
  process.stdout.write(`\nManifest: ${MANIFEST}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error); process.exit(1) })
}
