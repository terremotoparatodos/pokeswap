// @vitest-environment node
// Every species of the encounter catalog has its overworld sprite, normal and
// shiny. The URL comes from the engine's own helper, so this checks the paths
// the game would really request; the domain module itself never sees a file.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { existsSync } from 'node:fs'
// @ts-expect-error — idem
import { fileURLToPath } from 'node:url'
import { overworldSheetUrl } from '../../wildlands/engine/characters'
import { ECO_1_ENCOUNTER_CATALOG as catalog } from './initialCatalog'

const PUBLIC = fileURLToPath(new URL('../../../../public', import.meta.url))

/** Species ids whose normal or shiny overworld sheet is missing from public/. */
function missingSprites(speciesIds: readonly number[]): string[] {
  const missing: string[] = []
  for (const id of speciesIds) {
    for (const shiny of [false, true]) {
      const url = overworldSheetUrl(id, shiny)
      if (!existsSync(PUBLIC + url)) missing.push(url)
    }
  }
  return missing
}

describe('encounter sprites', () => {
  it('exist for every catalog species, normal and shiny', () => {
    const ids = [...new Set(catalog.entries.map(entry => entry.speciesId))]
    expect(ids).toHaveLength(33)
    expect(missingSprites(ids)).toEqual([])
  })

  it('negative control: a species without art is reported, both variants', () => {
    expect(missingSprites([16, 9999])).toEqual(['/assets/overworld/9999.png', '/assets/overworld/shiny/9999.png'])
  })
})
