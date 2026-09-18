// The Pokémon model (R32.2).
//
// One Pokémon, split into the three things it actually is:
//
//   `battle/catalog`  the species and its forms — shared and read-only (R32.1).
//   `instance.ts`     *this* Pokémon: nature, IVs, EVs, moves, owner, origin.
//   `runtime.ts`      what a battle does to it, and nothing that outlives one.
//
// Import from here; the files are an implementation detail.

export * from './stats'
// `MAX_LEVEL` comes from `stats`; the two agree and one of them has to win.
export { experienceForLevel, experienceToNextLevel, levelForExperience, xpToLevel } from './experience'
export * from './condition'
export * from './instance'
export * from './runtime'
export * from './party'
export * from './catalogView'
export * from './factory'
export * from './legacy'
export * from './migration'
