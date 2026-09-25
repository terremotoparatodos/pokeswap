// The three Skills PokeSwap has (SKILLS-1).
//
// Levels belong to the player. The Pokémon who does the work contributes its
// aptitude (aptitude/), never its own level. Fishing was removed on purpose and
// must not come back through a side door: a test pins this list.

export const SKILL_IDS = ['woodcutting', 'mining', 'farming'] as const
export type SkillId = (typeof SKILL_IDS)[number]

export interface SkillDefinition {
  readonly id: SkillId
  /** What the game calls it. */
  readonly name: string
  /** A verb the feedback line can use: "Talando…". */
  readonly working: string
  readonly icon: string
  /** One line. The world teaches the rest. */
  readonly pitch: string
}

export const SKILLS: Readonly<Record<SkillId, SkillDefinition>> = {
  woodcutting: {
    id: 'woodcutting', name: 'Talar', working: 'Talando', icon: '🌲',
    pitch: 'Tu Pokémon tala árboles y te trae madera.',
  },
  mining: {
    id: 'mining', name: 'Minería', working: 'Minando', icon: '⛏',
    pitch: 'Tu Pokémon rompe rocas y vetas y te trae minerales.',
  },
  farming: {
    id: 'farming', name: 'Agricultura', working: 'Cultivando', icon: '🌱',
    pitch: 'Tu Pokémon siembra, cuida y cosecha bayas y hierbas.',
  },
}

export const isSkillId = (value: unknown): value is SkillId =>
  typeof value === 'string' && (SKILL_IDS as readonly string[]).includes(value)
