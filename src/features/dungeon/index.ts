// Dungeon feature public API — R18
//
// The dungeon module owns the server boundary for dungeon sessions:
// entry energy deduction and reward application.
// Combat simulation remains client-side (INV-DGN-1).

export { startDungeon, submitDungeonReward } from './api/dungeonApi'
