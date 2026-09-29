// @vitest-environment node
// The Pradera auditor (`scripts/map/audit-pradera.ts`) is a tool people run
// by hand. A tool that prints its numbers and then dies with an exception is
// worse than no tool, and nothing else would notice: this runs the real script
// into a throwaway folder and requires a clean exit and the cave check line.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see serverBundle.test.ts)
import { spawnSync } from 'node:child_process'
// @ts-expect-error — idem
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
// @ts-expect-error — idem
import { tmpdir } from 'node:os'
// @ts-expect-error — idem
import { join } from 'node:path'
// @ts-expect-error — idem
import { execPath } from 'node:process'
// @ts-expect-error — idem
import { fileURLToPath } from 'node:url'
import { CAVES } from '../../../services/realtime/src/world/caves.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

describe('scripts/map/audit-pradera.ts', () => {
  it('finishes with exit 0 and measures the one canonical cave, reachable from the arrival', () => {
    const out = mkdtempSync(join(tmpdir(), 'pradera-audit-'))
    try {
      const run = spawnSync(execPath, [join(ROOT, 'node_modules/vite-node/vite-node.mjs'), 'scripts/map/audit-pradera.ts', '--', out], { cwd: ROOT, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      const [cave] = CAVES
      expect(run.stderr).toContain(`cave check: ok — (${cave.anchor.tx},${cave.anchor.ty}), approach (${cave.approach.tx},${cave.approach.ty})`)
      const audit = JSON.parse(readFileSync(join(out, 'audit.json'), 'utf8'))
      expect(audit.caves).toHaveLength(1)
      expect(audit.caves[0].anchor).toEqual({ ...cave.anchor })
      expect(audit.caves[0].steps).toBeGreaterThan(0)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 60_000)
})
