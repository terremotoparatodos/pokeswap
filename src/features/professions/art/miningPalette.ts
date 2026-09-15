// Mining palette. Rock tones come straight from WildLands props (ROCK_RECIPES);
// ore tones are new but follow the same rule: 3–4 tones, light from the top
// left, a dark outline, no pure black except inside coal.

export interface OreTones {
  /** dark → light */
  readonly tones: readonly [string, string, string]
  /** One-pixel highlight used on nuggets. */
  readonly glint: string
}

export const ORE_TONES = {
  stone: { tones: ['#8d8f97', '#b8bbc2', '#e6e8ea'], glint: '#ffffff' },
  coal: { tones: ['#141318', '#2b2931', '#56535f'], glint: '#c9c7d6' },
  iron: { tones: ['#7a3a1c', '#b45f2c', '#e39a5c'], glint: '#f2f5f8' },
  gold: { tones: ['#9a6410', '#dca521', '#ffe066'], glint: '#fffbe0' },
  shard: { tones: ['#5b2f8a', '#9a62d6', '#d9b8ff'], glint: '#f7efff' },
} as const satisfies Record<string, OreTones>

export const WOOD_TONES = ['#4a2c1a', '#6b4125', '#8c5a33', '#a8743f'] as const
export const WOOD_OUTLINE = '#2a180e'

export const TOOL_HEAD_TONES = {
  1: { tones: ['#5b5d66', '#80838c', '#a6a9b0', '#cfd1d4'], outline: '#34353c' },
  2: { tones: ['#5d6670', '#8b96a1', '#bcc6cf', '#eef2f5'], outline: '#343a42' },
  3: { tones: ['#2f4a63', '#4f7597', '#86aecd', '#dbeefe'], outline: '#1b2b3a' },
} as const

export const UI_NAVY = '#101a36'
export const UI_GOLD = '#ffd27a'
export const SPARK_TONES = ['#fffbe0', '#ffd27a', '#e39a5c'] as const
export const DUST_TONE = '#e8dcc8'
export const SPECIAL_TONE = '#c9a2ff'
