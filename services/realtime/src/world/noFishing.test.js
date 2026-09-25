import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { RESOURCE_VARIANTS, WORK_KIND } from './resourceLayout.js'
import { PLOTS } from './plots.js'
import { createSkillsWorldPolicy } from './skills/skills.generated.js'

// INTEGRATION-1: Pesca was removed by SKILLS-1 and must not come back through
// the server: not as a skill the rules know, not in the database schema, not
// as a WORLD resource or work kind. (The client side is guarded by
// src/features/skills/skillsIsolation.test.ts.)

test('the server knows exactly three skills and no fishing anywhere', async () => {
  const bundle = await readFile(new URL('./skills/skills.generated.js', import.meta.url), 'utf8')
  // Asked about a fishing spot, the real rules say it is not a resource.
  const policy = createSkillsWorldPolicy({ store: { async playerState() { return { xp: {}, materials: {}, pokemon: [] } }, async commitWork() { throw new Error('unused') } } })
  for (const variantId of ['shore', 'coral', 'reef']) {
    const answer = await policy.authorizeWorkAttempt({ actionId: '00000000-0000-4000-8000-000000000001', playerId: 'p', pokemon: { instanceId: 129, speciesId: 129 }, node: { id: `pradera:0:0:${variantId}`, resourceKind: 'fish', variantId, areaId: 'pradera', tx: 0, ty: 0, zone: 0, biome: 'beach' }, workKind: 'fish', requestedAt: 0 })
    assert.equal(answer.ok, false)
  }
  assert.doesNotMatch(bundle, /\bfishing\b|shore_spot|coastal_spot|reef_spot|basic_rod/)

  const migration = await readFile(new URL('../../../../supabase/migrations/20260926000001_world_skills_authority.sql', import.meta.url), 'utf8')
  for (const check of migration.matchAll(/skill_id IN \(([^)]*)\)/g)) assert.equal(check[1], "'woodcutting', 'mining', 'farming'")
  assert.doesNotMatch(migration, /fishing/)

  assert.deepEqual(Object.keys(WORK_KIND).sort(), ['plot', 'rock', 'tree'])
  for (const variant of Object.keys(RESOURCE_VARIANTS)) assert.doesNotMatch(variant, /shore|reef|coral|fish/)
  assert.ok(PLOTS.every(plot => plot.resourceKind === 'plot'))
})

test('no tool is ever part of a work request or its rules', async () => {
  const bundle = await readFile(new URL('./skills/skills.generated.js', import.meta.url), 'utf8')
  assert.doesNotMatch(bundle, /pickaxe|\baxe\b|\bhoe\b|toolTier|minToolTier|durability/)
})
