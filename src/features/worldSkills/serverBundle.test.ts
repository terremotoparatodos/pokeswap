// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs build script, no type declarations
import { bundleSkills } from '../../../scripts/integration/bundle-skills.mjs'
import generated from '../../../services/realtime/src/world/skills/skills.generated.js?raw'

// The realtime service runs the SKILLS rules from a generated bundle. It must
// be exactly what the current TypeScript builds to: a stale bundle would mean
// the server enforces different rules than the ones in review.
const unix = (text: string) => text.split('\r\n').join('\n')

describe('realtime SKILLS bundle', () => {
  it('is up to date with src/features/skills and src/features/worldSkills', async () => {
    expect(unix(generated) === unix(await bundleSkills())).toBe(true)
  })

  it('has no imports: the service runs it as is', () => {
    expect(generated).not.toMatch(/^import |require\(/m)
  })
})
