// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins are outside the frontend type environment
import { spawnSync } from 'node:child_process'
// @ts-expect-error — idem
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
// @ts-expect-error — idem
import { join } from 'node:path'
// @ts-expect-error — idem
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const BASE = '7739c4d4c1dba59b8dca3b66f379dea18082d108'
const CANDIDATE = 'fa14ab2cb99c6d80725a57ea7a109607a03c8ef2'
const BUNDLE = 'services/realtime/src/world/ecosystem/encounters.generated.js'

describe('audit F5 acceptance', () => {
  it('F5 CI provisions the real historical object in a fresh depth-one repository', () => {
    const cache = join(ROOT, 'node_modules/.cache')
    mkdirSync(cache, { recursive: true })
    const dir = mkdtempSync(join(cache, 'eco-shallow-'))
    const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    for (const args of [['init'], ['remote', 'add', 'origin', ROOT], ['fetch', '--depth=1', 'origin', CANDIDATE]]) {
      const r = git(...args)
      expect(r.status, r.stderr).toBe(0) // infrastructure must succeed before exercising the gate
    }
    expect(git('rev-parse', '--is-shallow-repository').stdout.trim()).toBe('true')
    expect(git('cat-file', '-e', `${BASE}^{commit}`).status).not.toBe(0)
    const workflow: string = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    // Execute the exact pinned fetch present in CI; absence leaves the baseline missing,
    // which is the defect being asserted (not a timeout, import failure or skipped comparison).
    const instruction = workflow.match(/git fetch --no-tags --depth=1 origin ([0-9a-f]{40})/)
    if (instruction) {
      const r = git('fetch', '--no-tags', '--depth=1', 'origin', instruction[1])
      expect(r.status, r.stderr).toBe(0)
    }
    const historical = git('show', `${BASE}:${BUNDLE}`)
    expect(historical.status, 'the real compatibility commit must be present after the CI preparation').toBe(0)
    const original = spawnSync('git', ['show', `${BASE}:${BUNDLE}`], { cwd: ROOT, encoding: 'utf8' })
    expect(original.status, original.stderr).toBe(0)
    expect(historical.stdout).toBe(original.stdout)
    expect(historical.stdout).toContain('function tickPopulation')
  })
})
