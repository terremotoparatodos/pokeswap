// R33 — which half of this ships, and which half is the harness.
//
// The delivery had a sentence that read as a contradiction: "the furnace runs
// in Pradera" next to "the furnace is not in `dist/`". Both were true and the
// sentence was bad, so this test makes the split explicit and keeps it honest.
//
// There are two halves:
//
//   PRODUCTION  the engine's physical layer. `placedObjects.ts`, `picking.ts`,
//               `renderer.ts` and `game.ts` are code every player runs, and
//               R33's multi-tile footprint work lives there. It ships, and it
//               is in the WildLands chunk of every build.
//
//   DEV ONLY    everything under `features/professions/`, station contracts
//               included. It is reachable from the app through exactly two
//               entry points, both behind `import.meta.env.DEV`, so Rollup
//               drops the whole feature from a production build. That is why
//               the furnace is not in `dist/` — not a build accident, and not
//               a claim that the code is unfinished.
//
// The station *domain* is written to production standards and has no DEV gate
// of its own: what keeps it out of the bundle is that nothing productive
// imports professions yet, which is a product decision (there is no reason to
// show players a furnace) and not a technical limit.

import { describe, expect, it } from 'vitest'

const ALL = import.meta.glob<string>('../../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })

// Vite keys these relative to *this* file: siblings as './x.ts', the rest of
// the feature as '../x/y.ts', and everything else as '../../…'.
const isStationModule = (path: string) => path.startsWith('./')
const isProfessions = (path: string) => path.startsWith('./') || (path.startsWith('../') && !path.startsWith('../../'))

const find = (suffix: string): [string, string] => {
  const hit = Object.entries(ALL).find(([path]) => path.endsWith(suffix))
  if (!hit) throw new Error(`source not found: ${suffix}`)
  return hit
}

/** The engine files R33 changed. Production code, in every build. */
const PRODUCTION_ENGINE = [
  'wildlands/engine/placedObjects.ts',
  'wildlands/engine/picking.ts',
  'wildlands/engine/renderer.ts',
  'wildlands/engine/game.ts',
]

/** The two doors the whole professions feature is allowed behind. */
const DEV_ENTRY_POINTS = [
  'app/router/routes.ts',
  'wildlands/components/WildlandsView.vue',
]

describe('the production half', () => {
  it('is the engine physical layer, and it carries R33 multi-tile work', () => {
    const [, placed] = find(PRODUCTION_ENGINE[0])
    // The generic shape, the front-centre projection and the tap retarget.
    expect(placed).toMatch(/export function placedFeet/)
    expect(placed).toMatch(/export function nearestTile/)
    expect(placed).toMatch(/readonly cells\?:/)
  })

  it('is used by production code, not gated behind a dev flag', () => {
    for (const suffix of PRODUCTION_ENGINE) {
      const [path, source] = find(suffix)
      expect(source, path).not.toMatch(/import\.meta\.env\.DEV/)
    }
  })

  it('and the renderer and the game really call it, so it cannot be shaken out', () => {
    const [, renderer] = find('wildlands/engine/renderer.ts')
    const [, game] = find('wildlands/engine/game.ts')
    expect(renderer).toMatch(/placedFeet\(object, TILE\)/)
    expect(game).toMatch(/nearestTile\(object, this\.player\.tx, this\.player\.ty\)/)
  })

  it('knows nothing about professions or stations', () => {
    // Comments explain what a smelter or a furnace *would* be; code must not
    // know. `'smelter'` is a `PlacedObjectKind` and predates R33 — a label the
    // engine carries, not a concept it acts on.
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const suffix of PRODUCTION_ENGINE) {
      const [path, source] = find(suffix)
      expect(code(source), path).not.toMatch(/from '[^']*professions/)
      expect(code(source), path).not.toMatch(/StationProcess|StationDefinition|StationPlacement|recipe/i)
    }
  })
})

describe('the dev-only half', () => {
  const stationSources = Object.entries(ALL)
    .filter(([path]) => isStationModule(path) && !path.endsWith('.test.ts'))

  it('has the station modules in it', () => {
    expect(stationSources.length).toBeGreaterThan(8)
  })

  it('is reached from the app through two entry points and nowhere else', () => {
    const referrers = Object.entries(ALL)
      .filter(([path]) => !isProfessions(path) && !path.endsWith('.test.ts'))
      .filter(([, source]) => /features\/professions|\.\.\/professions\//.test(source))
      .map(([path]) => path)
    expect(referrers).toHaveLength(2)
    for (const suffix of DEV_ENTRY_POINTS) expect(referrers.some(path => path.endsWith(suffix)), suffix).toBe(true)
  })

  it('and both of those doors are shut in a production build', () => {
    for (const suffix of DEV_ENTRY_POINTS) {
      const [path, source] = find(suffix)
      for (const line of source.split('\n').filter(entry => /features\/professions|\.\.\/professions\//.test(entry))) {
        expect(line, path).toMatch(/import\.meta\.env\.DEV/)
      }
    }
  })

  it('but the station domain itself has no dev gate: nothing about it is a prototype', () => {
    for (const [path, source] of stationSources) {
      // A module that guarded itself would have to be un-guarded to ship.
      expect(source, path).not.toMatch(/import\.meta\.env\.DEV/)
    }
  })

  it('the harness is the panel, the poll and the local session — named, so the split is not a feeling', () => {
    // Everything a human needs to drive the furnace, and nothing a server
    // would run. `stationSession` is the local bag adapter; the controller is
    // the Vue surface and the only place a wall clock is read.
    const harness = ['useFurnaceController.ts', 'stationSession.ts', 'furnaceOverlay.ts', 'devStationPlacement.ts']
    for (const name of harness) expect(stationSources.some(([path]) => path.endsWith(name)), name).toBe(true)
    const [, controller] = find('./useFurnaceController.ts')
    expect(controller).toMatch(/from 'vue'/)
  })
})
