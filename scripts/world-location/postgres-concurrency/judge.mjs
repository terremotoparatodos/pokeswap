// WORLD LOCATION-4 F2 — the verdict of a battery run. Pure (no database); unit tests: judge.test.mjs.
//
// One scenario round ends in exactly one outcome:
//   pass           every assertion held;
//   violation      an invariant assertion failed (node:assert AssertionError) — the ONLY detection;
//   harness_error  anything else: a deadline, a barrier that could not be confirmed, an unexpected
//                  SQL error (a deadlock included), a closed connection. Never a detection.
//
// The battery's verdict for a build:
//   original  every round of every scenario passes;
//   rv1, rv2  every round of each DETECTING scenario is a violation, and every round of every other
//             scenario passes (a detection elsewhere means the scenario is not specific).
// Any harness_error makes the run BLOCKED, whatever else happened: a mutant is never "caught" by
// infrastructure, and the original never "passes" around it.

/** Which scenarios must detect each negative control (localDatabase.mjs MUTANTS). */
export const DETECTS = { original: [], rv1: ['A1', 'A2', 'A4'], rv2: ['A5', 'A6'] }

export function outcomeOf(error, AssertionError) {
  if (!error) return 'pass'
  return error instanceof AssertionError ? 'violation' : 'harness_error'
}

/**
 * @param {string} build  original | rv1 | rv2
 * @param {{ scenario: string, outcome: 'pass'|'violation'|'harness_error' }[]} results
 * @param {string[]} scenarios  the scenario ids that were meant to run
 * @returns {{ verdict: 'PASS'|'FAIL'|'BLOCKED', reasons: string[], table: Record<string, {pass:number, violation:number, harness_error:number}> }}
 */
export function judgeRun(build, results, scenarios) {
  if (!(build in DETECTS)) throw new Error(`unknown build ${build}`)
  const table = {}
  for (const id of scenarios) table[id] = { pass: 0, violation: 0, harness_error: 0 }
  for (const r of results) {
    if (!table[r.scenario]) throw new Error(`result for an unknown scenario ${r.scenario}`)
    table[r.scenario][r.outcome]++
  }
  const reasons = []
  const errors = Object.entries(table).filter(([, t]) => t.harness_error > 0)
  for (const [id, t] of errors) reasons.push(`${id}: ${t.harness_error} harness_error (never a detection)`)
  const empty = Object.entries(table).filter(([, t]) => t.pass + t.violation + t.harness_error === 0)
  for (const [id] of empty) reasons.push(`${id}: did not run`)
  if (errors.length || empty.length || results.length === 0) return { verdict: 'BLOCKED', reasons, table }

  for (const id of DETECTS[build]) if (!table[id]) reasons.push(`${id}: a detecting scenario was not selected`)
  for (const [id, t] of Object.entries(table)) {
    const mustDetect = DETECTS[build].includes(id)
    if (mustDetect && t.pass > 0) reasons.push(`${id}: ${build} survived ${t.pass} round(s)`)
    if (!mustDetect && t.violation > 0) reasons.push(`${id}: ${t.violation} violation(s) on ${build}${build === 'original' ? '' : ' (not a detecting scenario)'}`)
  }
  return { verdict: reasons.length ? 'FAIL' : 'PASS', reasons, table }
}
