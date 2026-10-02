import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { ARRIVALS } from '../protocol/arrival.js'
import { CAVE_INTERIORS } from './caveLayouts.js'
import { CANONICAL_NAVIGATION, PERSISTABLE_AREAS, isPersistableArea, layoutSource, layoutVersion, praderaFacts, praderaFingerprintWindow, versionOf } from './layoutVersion.js'
import { isSafeLanding } from './navigation.js'
import { TERRAIN_GENERATOR_VERSION } from './terrain.js'

// WORLD LOCATION-2 (D-L8): one layout version per persistable area.
//
// FROZEN. If this test fails, the navigation of an area changed. That is
// allowed, but it is a product decision: every saved location in that area
// will restore at the area's arrival (WORLD_LOCATION_1_AUDIT §4.6). Update
// the expected value here in the same commit that changes the map, and say
// so in its message.
const FROZEN = Object.freeze({
  'ciudad-corazon': '1.f04b84e25e1a',
  // Review M2 (complete canonical data, no sampled lattice): was 1.bbce2fd97f67.
  pradera: '1.7eb512c66092',
  'cueva-inicial': '1.54820710979b',
})

test('the layout version of every persistable area is frozen', () => {
  assert.deepEqual(Object.fromEntries(PERSISTABLE_AREAS.map(area => [area, layoutVersion(area)])), FROZEN)
})

test('persistable areas: Ciudad, Pradera and every cave interior; nothing else (no Dungeon floor, no unknown area)', () => {
  assert.deepEqual([...PERSISTABLE_AREAS].sort(), ['ciudad-corazon', 'pradera', ...Object.keys(CAVE_INTERIORS)].sort())
  for (const areaId of ['tundra', 'dg:cueva-inicial:1', '', null, 42, '__proto__', 'constructor', 'Pradera']) {
    assert.equal(isPersistableArea(areaId), false, String(areaId))
    assert.equal(layoutVersion(areaId), null, String(areaId))
  }
  for (const areaId of PERSISTABLE_AREAS) assert.ok(isSafeLanding(areaId, ARRIVALS[areaId].tx, ARRIVALS[areaId].ty), `${areaId} arrival is a safe landing`)
})

test('a version fits the column (layout_version ~ ^[a-z0-9.-]{1,32}$) and is deterministic', () => {
  for (const areaId of PERSISTABLE_AREAS) {
    assert.match(layoutVersion(areaId), /^[a-z0-9.-]{1,32}$/)
    assert.equal(versionOf(layoutSource(areaId)), layoutVersion(areaId))
  }
})

test('the version follows the navigation: one tile that changes class changes it (each area)', () => {
  const probes = { 'ciudad-corazon': ARRIVALS['ciudad-corazon'], pradera: ARRIVALS.pradera, 'cueva-inicial': ARRIVALS['cueva-inicial'] }
  for (const [areaId, at] of Object.entries(probes)) {
    const blocked = { ...CANONICAL_NAVIGATION, isWalkable: (a, tx, ty) => !(a === areaId && tx === at.tx && ty === at.ty) && CANONICAL_NAVIGATION.isWalkable(a, tx, ty) }
    assert.notEqual(versionOf(layoutSource(areaId, blocked)), layoutVersion(areaId), `${areaId}: a solid arrival must change the version`)
    const pocket = { ...CANONICAL_NAVIGATION, isReachable: (a, tx, ty) => !(a === areaId && tx === at.tx && ty === at.ty) && CANONICAL_NAVIGATION.isReachable(a, tx, ty) }
    assert.notEqual(versionOf(layoutSource(areaId, pocket)), layoutVersion(areaId), `${areaId}: a fenced-off tile must change the version`)
  }
})

test("Pradera's dense window covers the arrival, both zones and the cave, with a margin", () => {
  const w = praderaFingerprintWindow()
  assert.ok(w.maxTx - w.minTx >= 60 && w.maxTy - w.minTy >= 80, JSON.stringify(w))
  for (const t of [ARRIVALS.pradera, { tx: -19, ty: -54 }, { tx: 18, ty: -63 }, { tx: -14, ty: -91 }]) {
    assert.ok(t.tx > w.minTx && t.tx < w.maxTx && t.ty > w.minTy && t.ty < w.maxTy, `${t.tx},${t.ty}`)
  }
})

test('an area only changes its own version', () => {
  const caveOnly = { ...CANONICAL_NAVIGATION, isWalkable: (a, tx, ty) => a === 'cueva-inicial' ? false : CANONICAL_NAVIGATION.isWalkable(a, tx, ty) }
  assert.equal(versionOf(layoutSource('ciudad-corazon', caveOnly)), layoutVersion('ciudad-corazon'))
  assert.notEqual(versionOf(layoutSource('cueva-inicial', caveOnly)), layoutVersion('cueva-inicial'))
})

// ── Pradera: complete canonical data + an explicit generator version (review M2) ──

const pradera = facts => versionOf(layoutSource('pradera', CANONICAL_NAVIGATION, facts))
// Off the old 64-tile lattice (whose points were -4096 + 64k on both axes) and far from every authored place.
const FAR = { tx: 1000, ty: 1001 }

test('Pradera: a change to ANY canonical datum changes the version, also far outside the old lattice', () => {
  assert.equal(pradera(praderaFacts()), layoutVersion('pradera'))
  assert.ok((FAR.tx + 4096) % 64 !== 0 && (FAR.ty + 4096) % 64 !== 0, 'not a lattice point')
  const facts = praderaFacts()
  const changes = {
    'a prop planted far away (authored layer)': { ...facts, authored: [...facts.authored, [`pradera:${FAR.tx}:${FAR.ty}`, 'rock']] },
    'a prop cleared far away (authored layer)': { ...facts, authored: [...facts.authored, [`pradera:${FAR.tx}:${FAR.ty}`, null]] },
    'the generator version': { ...facts, generator: facts.generator + 1 },
    'the seed': { ...facts, seed: facts.seed + 1 },
    'the bounds': { ...facts, bounds: { ...facts.bounds, maxTx: facts.bounds.maxTx - 1 } },
    'the arrival': { ...facts, arrival: { ...facts.arrival, tx: facts.arrival.tx + 1 } },
    'the return pad': { ...facts, returnPad: { ...facts.returnPad, ty: facts.returnPad.ty - 1 } },
    'a portal': { ...facts, portals: facts.portals.map((p, i) => (i === 0 ? { ...p, tx: FAR.tx } : p)) },
    'a zone': { ...facts, zones: facts.zones.map((z, i) => (i === 0 ? { ...z, box: { ...z.box, x1: z.box.x1 + 1 } } : z)) },
    'a reserved area': { ...facts, reserved: [...facts.reserved, { areaId: 'pradera', box: { x0: FAR.tx, y0: FAR.ty, x1: FAR.tx, y1: FAR.ty } }] },
    'a route': { ...facts, routes: facts.routes.slice(1) },
    'a cave': { ...facts, caves: facts.caves.map(c => ({ ...c, mouth: { ...c.mouth, tx: c.mouth.tx + 1 } })) },
  }
  for (const [what, changed] of Object.entries(changes)) assert.notEqual(pradera(changed), layoutVersion('pradera'), what)
})

test('Pradera: nothing is sampled — the lattice is gone and every authored tile of the area is hashed', async () => {
  const facts = praderaFacts()
  assert.equal(facts.generator, TERRAIN_GENERATOR_VERSION)
  const all = [...(await import('./resourceZoneLayout.js')).AUTHORED_DECOR.keys()].filter(key => key.startsWith('pradera:'))
  assert.equal(facts.authored.length, all.length)
  assert.doesNotMatch(readFileSync(new URL('./layoutVersion.js', import.meta.url), 'utf8'), /LATTICE|step = /, 'no sparse scan left')
})

// The guard behind TERRAIN_GENERATOR_VERSION: the CODE Pradera's collision is
// computed by. Data is hashed into the version at runtime; code cannot be, so
// a code change must come with a new generator version. If this fails: did
// the change move any tile of any seed? Yes, or not sure → bump
// TERRAIN_GENERATOR_VERSION in terrain.js and ADD its digest below. Provably
// not (a rename, a comment) → still add an entry: never edit an existing one.
const GENERATOR_SOURCES = ['terrain.js', 'resourceZones.js', 'caves.js', 'navigation.js']
const GENERATOR_DIGESTS = Object.freeze({
  1: '2040d72d93cc781d',
})

/** Code only: block and line comments and all whitespace removed (a comment never needs a bump). */
function codeDigest(texts) {
  const code = texts.map(text => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '')).join('\u0000')
  return createHash('sha256').update(code).digest('hex').slice(0, 16)
}
const sources = () => GENERATOR_SOURCES.map(file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))

test('guard: the generator and collision code match the digest frozen for TERRAIN_GENERATOR_VERSION', () => {
  assert.equal(codeDigest(sources()), GENERATOR_DIGESTS[TERRAIN_GENERATOR_VERSION],
    'the code Pradera\'s collision is made of changed: bump TERRAIN_GENERATOR_VERSION (terrain.js) and add its digest here')
})

test('guard: a generator edit that only touches tiles far from every authored place is caught; a comment is not', () => {
  const texts = sources()
  const edited = texts.map((text, i) => (i === 0 ? text.replace('if (r < 0.03) return \'tree\'', 'if (r < 0.031) return \'tree\'') : text))
  assert.notEqual(edited[0], texts[0], 'the edit applied')
  assert.notEqual(codeDigest(edited), codeDigest(texts), 'one decor threshold: a different world')
  const commented = texts.map((text, i) => (i === 0 ? `// a note\n${text.replace('/** Integer hash', '/** An integer hash')}` : text))
  assert.equal(codeDigest(commented), codeDigest(texts))
})

test('guard: client, server and persistence run the same generator (no browser fork)', () => {
  const engine = new URL('../../../../src/features/wildlands/engine/', import.meta.url)
  const world = readFileSync(new URL('world.ts', engine), 'utf8')
  const noise = readFileSync(new URL('noise.ts', engine), 'utf8')
  assert.match(world, /from '\.\.\/\.\.\/\.\.\/\.\.\/services\/realtime\/src\/world\/terrain\.js'/)
  assert.match(world, /import \{ decorAtArea, isSolidAtArea \} from '\.\.\/\.\.\/\.\.\/\.\.\/services\/realtime\/src\/world\/resourceZones\.js'/)
  assert.match(noise, /export \{ fbm, hash2, valueNoise \} from '\.\.\/\.\.\/\.\.\/\.\.\/services\/realtime\/src\/world\/terrain\.js'/)
  for (const file of readdirSync(engine).filter(name => name.endsWith('.ts'))) {
    const text = readFileSync(new URL(file, engine), 'utf8')
    assert.doesNotMatch(text, /function (hash2|valueNoise|fbm|biomeAt|vertexTerrain|tileTerrain|decorAt|decorAtArea|isSolidAtArea|isSolidTile)\(/, `${file} must not re-implement the shared generator`)
  }
  assert.match(world, /isSolidDecor\(kind: DecorKind \| null\): boolean \{\s*return sharedIsSolidDecor\(kind\)/, 'the browser solidity is the shared one')
  // Persistence reads the same constant the generator exports.
  assert.equal(praderaFacts().generator, TERRAIN_GENERATOR_VERSION)
})

test('cost: a fresh Pradera fingerprint reads a bounded window only, and is never paid on a save (the service computes it at start)', async () => {
  // Deterministic, not wall time (the full suite runs files in parallel): count the tiles it reads.
  // Wall time is measured where it matters, in the 100-player benchmark (event-loop max).
  const window = praderaFingerprintWindow()
  const tiles = (window.maxTx - window.minTx + 1) * (window.maxTy - window.minTy + 1)
  assert.ok(tiles < 20_000, `a bounded window, never the ±4096 square (${tiles} tiles)`)
  const read = new Set()
  let outside = 0
  const counted = fn => (a, tx, ty) => {
    if (a === 'pradera') { read.add(`${tx},${ty}`); if (tx < window.minTx || tx > window.maxTx || ty < window.minTy || ty > window.maxTy) outside++ }
    return fn(a, tx, ty)
  }
  versionOf(layoutSource('pradera', { isWalkable: counted(CANONICAL_NAVIGATION.isWalkable), isReachable: counted(CANONICAL_NAVIGATION.isReachable), portalAt: counted(CANONICAL_NAVIGATION.portalAt) }))
  assert.equal(outside, 0, 'no tile outside the authored window is read')
  assert.equal(read.size, tiles, 'each window tile is read, nothing else')
  const { LocationService } = await import('../presence/locationService.js')
  const { savedLocationOf } = await import('../presence/locationPolicy.js')
  new LocationService({ mode: 'on', store: { locationClaim: async () => ({}), locationSave: async () => new Map() } }).disable()
  const save = performance.now()
  savedLocationOf({ areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  assert.ok(performance.now() - save < 5, 'the first save reads a cached version')
})
