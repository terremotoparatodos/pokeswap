// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs build script, no type declarations
import { bundleSkills, OUTPUT } from '../../../scripts/integration/bundle-skills.mjs'

// The realtime service runs the SKILLS rules from a generated bundle. It must
// be exactly what the current TypeScript builds to: a stale bundle would mean
// the server enforces different rules than the ones in review.
describe('realtime SKILLS bundle', () => {
  it('is up to date with src/features/skills and src/features/worldSkills', async () => {
    const committed = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n')
    expect(committed === (await bundleSkills())).toBe(true)
  })

  it('has no imports: the service runs it as is', () => {
    expect(readFileSync(OUTPUT, 'utf8')).not.toMatch(/^import |require\(/m)
  })
})
