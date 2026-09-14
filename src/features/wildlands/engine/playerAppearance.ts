import type { Actor } from './actors'
import { loadTrainerSheet, type TrainerSprites } from './characters'
import type { PlayerCharacter } from '../identity/playerCharacters'

/** Applies asynchronous character sheets without allowing stale loads to win. */
export class PlayerAppearance {
  private generation = 0
  private activeUrl: string | null = null

  constructor(
    private readonly player: Actor,
    private readonly fallback: TrainerSprites,
    private readonly load = loadTrainerSheet,
  ) {}

  set(character: PlayerCharacter): void {
    if (character.sheetUrl === this.activeUrl) return
    this.activeUrl = character.sheetUrl
    const generation = ++this.generation
    this.player.trainer = this.fallback
    this.player.trainerRun = undefined
    void this.load(character.sheetUrl)
      .then(sheet => {
        if (generation !== this.generation) return
        this.player.trainer = sheet.walk
        this.player.trainerRun = sheet.run
      })
      .catch(() => {
        if (generation !== this.generation) return
        this.player.trainer = this.fallback
        this.player.trainerRun = undefined
      })
  }
}
