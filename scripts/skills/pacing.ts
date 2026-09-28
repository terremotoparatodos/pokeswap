// Skills pacing estimate: how long 1→50 takes in each skill (SKILLS PROB-2).
//
//   npm run skills:pacing
//   npm run skills:pacing -- --aptitude 5 --overhead 2
//
// Only the command line lives here. The model is src/features/skills/domain/
// pacing.ts, built on the canonical probabilistic work functions and the
// protocol's work tick, so this tool and the server cannot disagree
// (pacing.test.ts guards it).

import type { Aptitude } from '../../src/features/skills/domain/aptitude/aptitudeScale'
import { ATTEMPTS, MAX_SKILL_LEVEL } from '../../src/features/skills/domain/balance'
import { DEFAULT_PACING, PACING_MARKS, farmingPacing, gatherPacing, type PacingOptions } from '../../src/features/skills/domain/pacing'
import { totalXpForLevel } from '../../src/features/skills/domain/xpCurve'
import { WORK_TICK_MS } from '../../services/realtime/src/world/worldProtocol.js'

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? Number(process.argv[index + 1]) : fallback
}

const options: PacingOptions = {
  aptitude: arg('aptitude', DEFAULT_PACING.aptitude) as Aptitude,
  overhead: arg('overhead', DEFAULT_PACING.overhead),
  walk: arg('walk', DEFAULT_PACING.walk),
  plots: arg('plots', DEFAULT_PACING.plots),
}

const pad = (text: string, width: number) => text.padEnd(width)
console.log(`Skills pacing · aptitude ${options.aptitude} · overhead ${options.overhead}s · walk ${options.walk}s · ${options.plots} plots`)
console.log(`Probabilistic work · tick ${WORK_TICK_MS} ms · γ ${ATTEMPTS.curveGamma} · unlock ×${ATTEMPTS.unlockSlowdown} · cap ⌈${ATTEMPTS.capFactor}/p⌉ in [${ATTEMPTS.minAttempts}, ${ATTEMPTS.maxAttempts}] (expected times)`)
console.log(`XP to 50: ${totalXpForLevel(MAX_SKILL_LEVEL).toLocaleString('es')}\n`)
for (const [name, table] of [['Talar', gatherPacing('woodcutting', options)], ['Minería', gatherPacing('mining', options)], ['Agricultura', farmingPacing(options)]] as const) {
  console.log(name)
  for (const mark of PACING_MARKS) {
    const row = table.get(mark)
    if (row) console.log(`  Nv ${pad(String(mark), 3)} ${pad(row.hours.toFixed(2) + ' h', 9)} (trabajando ${row.subject})`)
  }
}
