// Skills pacing estimate: how long 1→50 takes in each skill, from the real
// catalogs and curve.
//
//   npm run skills:pacing
//   npm run skills:pacing -- --aptitude 5 --overhead 2
//
// Model (deliberately simple, stated so it can be argued with):
//   Talar / Minería  the player always works the best resource unlocked, with
//                    one worker of the given aptitude; every action costs its
//                    duration plus `overhead` seconds (walking, picking, the
//                    card), and a depleted node costs `walk` more seconds.
//   Agricultura      `plots` plots in parallel on the best crop unlocked; each
//                    cycle is grow time + plant/tend/harvest + `walk` seconds.
// It estimates active play, not a real player's evening.

import type { Aptitude } from '../../src/features/skills/domain/aptitude/aptitudeScale'
import { CROPS, FARM_ACTION_MS, PLOT_WORLD_HINTS } from '../../src/features/skills/domain/farming'
import { RESOURCES } from '../../src/features/skills/domain/resources'
import { MAX_SKILL_LEVEL } from '../../src/features/skills/domain/balance'
import { workDuration } from '../../src/features/skills/domain/workRules'
import { levelForXp, totalXpForLevel } from '../../src/features/skills/domain/xpCurve'

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? Number(process.argv[index + 1]) : fallback
}

const aptitude = arg('aptitude', 3) as Aptitude
const overhead = arg('overhead', 1.5)
const walk = arg('walk', 8)
const plots = arg('plots', PLOT_WORLD_HINTS.town.perPlayer)
const MARKS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]

function gatherHours(skill: 'woodcutting' | 'mining'): Map<number, { hours: number; resource: string }> {
  const ladder = RESOURCES.filter(resource => resource.skill === skill)
  const out = new Map<number, { hours: number; resource: string }>()
  let xp = 0
  let seconds = 0
  while (levelForXp(xp) < MAX_SKILL_LEVEL) {
    const level = levelForXp(xp)
    const resource = [...ladder].reverse().find(entry => entry.requiredLevel <= level && entry.minAptitude <= aptitude)!
    const charges = (resource.world.charges[0] + resource.world.charges[1]) / 2
    seconds += workDuration(resource.baseDurationMs, aptitude, level) / 1000 + overhead + walk / charges
    xp += resource.xp
    const reached = levelForXp(xp)
    if (reached > level && MARKS.includes(reached)) out.set(reached, { hours: seconds / 3600, resource: resource.name })
  }
  return out
}

function farmingHours(): Map<number, { hours: number; resource: string }> {
  const out = new Map<number, { hours: number; resource: string }>()
  let xp = 0
  let seconds = 0
  while (levelForXp(xp) < MAX_SKILL_LEVEL) {
    const level = levelForXp(xp)
    const crop = [...CROPS].reverse().find(entry => entry.requiredLevel <= level && entry.minAptitude <= aptitude)!
    const actions = (FARM_ACTION_MS.plant + FARM_ACTION_MS.tend + FARM_ACTION_MS.harvest) / 1000
    seconds += crop.growMs / 1000 + actions + walk
    xp += plots * (crop.xp.plant + crop.xp.tend + crop.xp.harvest)
    const reached = levelForXp(xp)
    if (reached > level) for (const mark of MARKS) if (mark > level && mark <= reached) out.set(mark, { hours: seconds / 3600, resource: crop.name })
  }
  return out
}

const pad = (text: string, width: number) => text.padEnd(width)
console.log(`Skills pacing · aptitude ${aptitude} · overhead ${overhead}s · walk ${walk}s · ${plots} plots`)
console.log(`XP to 50: ${totalXpForLevel(MAX_SKILL_LEVEL).toLocaleString('es')}\n`)
for (const [name, table] of [['Talar', gatherHours('woodcutting')], ['Minería', gatherHours('mining')], ['Agricultura', farmingHours()]] as const) {
  console.log(name)
  for (const mark of MARKS) {
    const row = table.get(mark)
    if (row) console.log(`  Nv ${pad(String(mark), 3)} ${pad(row.hours.toFixed(2) + ' h', 9)} (trabajando ${row.resource})`)
  }
}
