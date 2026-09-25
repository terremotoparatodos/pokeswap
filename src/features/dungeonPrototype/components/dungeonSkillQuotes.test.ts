import { describe, expect, it } from 'vitest'
import source from './PlayDungeon.vue?raw'

// INTEGRATION-1: the dungeon does not enforce any Skills level yet, so its UI
// must not promise one ("Minería Nv. 45"). Quote the skill, not a level, until
// a real Dungeon ↔ Skills gate exists.
describe('dungeon skill quotes', () => {
  it('never renders a Skills level requirement', () => {
    expect(source).not.toMatch(/need\.level|requirement\.level|requirementForObstacle\([^)]*\)\.level/)
  })
})
