import { describe, expect, it } from 'vitest'
import {
  actorPosition, advance, createActor, createWalkerState, driveWalker, isMoving, TURN_DELAY, tryStep, wander,
  RUN_SPEED, WALK_SPEED, walkFrame, type Actor, type MoveRules, type WalkerState,
} from './actors'
import { overworldSheetUrl, type Dir } from './characters'
import { candidatesFor, normaliseType, type PokedexEntry } from './population'

const open: MoveRules = { blocked: () => false, occupied: () => false }

describe('grid movement', () => {
  it('glides to the next tile and stops there', () => {
    const actor = createActor({ id: 'a', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: 4 })
    expect(tryStep(actor, 'right', open)).toBe(true)
    expect(isMoving(actor)).toBe(true)
    advance(actor, 0.125)
    expect(actorPosition(actor).x).toBeCloseTo(16)
    advance(actor, 1)
    expect(isMoving(actor)).toBe(false)
    expect(actor.tx).toBe(1)
  })

  it('turns but does not move into blocked tiles', () => {
    const actor = createActor({ id: 'a', kind: 'player', habitat: 'any', tx: 0, ty: 0 })
    const wall: MoveRules = { blocked: (_a, tx) => tx === -1, occupied: () => false }
    expect(tryStep(actor, 'left', wall)).toBe(false)
    expect(actor.dir).toBe('left')
    expect(actor.tx).toBe(0)
  })

  it('pulls wanderers back toward home', () => {
    const actor = createActor({ id: 'w', kind: 'npc', habitat: 'land', tx: 9, ty: 0, homeTx: 0, homeTy: 0 })
    // Rolls: think delay, "walk instead of turning", random direction (overridden by homing).
    const rolls = [0.5, 0.9, 0.0]
    wander(actor, 10, open, () => rolls.shift() ?? 0.5)
    expect(actor.tx).toBe(8)
  })
})

describe('driveWalker', () => {
  const frame = 1 / 60
  const hold = (actor: Actor, dir: Dir | null, seconds: number, rules: MoveRules, state: WalkerState) => {
    for (let t = 0; t < seconds - 1e-9; t += frame) driveWalker(actor, dir, frame, rules, state)
  }

  it('chains tiles while held, with no stall frame between them', () => {
    const actor = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: WALK_SPEED })
    const state = createWalkerState()
    const xs: number[] = []
    for (let i = 0; i < 60; i++) {
      driveWalker(actor, 'down', frame, open, state)
      xs.push(actorPosition(actor).y)
    }
    // After the first frame every frame advances (no repeated position at tile boundaries).
    for (let i = 2; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] - 1e-9)
    expect(xs.filter((y, i) => i > 0 && y === xs[i - 1]).length).toBeLessThanOrEqual(1)
    expect(actor.ty).toBe(4) // 3.75 tiles/s → the fourth tile is under way after one second
  })

  it('a short tap from standing only turns', () => {
    const actor = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: WALK_SPEED })
    const state = createWalkerState()
    hold(actor, 'left', 0.05, open, state)
    hold(actor, null, 0.2, open, state)
    expect(actor.dir).toBe('left')
    expect(actor.tx).toBe(0)
    expect(isMoving(actor)).toBe(false)
  })

  it('holding past the turn delay starts walking; facing the way already walks at once', () => {
    const actor = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: WALK_SPEED })
    const state = createWalkerState()
    hold(actor, 'left', TURN_DELAY + 0.05, open, state)
    expect(actor.tx).toBe(-1)
    hold(actor, null, 1, open, state)
    driveWalker(actor, 'left', frame, open, state)
    expect(isMoving(actor)).toBe(true)
  })

  describe('gait changes while chaining steps', () => {
    // Wired like game.ts: the gait is latched when each step starts and the
    // arrival reports the gait of the step that just completed.
    const drive = (script: (t: number) => boolean, seconds: number) => {
      const actor = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, dir: 'right', speed: WALK_SPEED })
      const state = createWalkerState()
      let shift = false
      const latch = (a: Actor) => { a.running = shift; a.speed = shift ? RUN_SPEED : WALK_SPEED }
      const arrivals: { t: number; tx: number; running: boolean }[] = []
      const speeds: number[][] = []
      let t = 0
      for (; t < seconds - 1e-9; t += frame) {
        shift = script(t)
        if (!isMoving(actor)) latch(actor)
        driveWalker(actor, 'right', frame, open, state, tx => arrivals.push({ t, tx, running: actor.running }), false, latch)
        ;(speeds[actor.tx] ??= []).push(actor.speed)
      }
      return { arrivals, speeds }
    }
    const tileTimes = (arrivals: { t: number }[]) => arrivals.slice(1).map((a, i) => a.t - arrivals[i].t)

    it('walk → run without stopping: the next tile runs', () => {
      const { arrivals } = drive(t => t >= 1.1, 2.5)
      const times = tileTimes(arrivals)
      expect(times.slice(0, 2).every(d => Math.abs(d - 1 / WALK_SPEED) < 2 * frame)).toBe(true)
      expect(times.slice(-4).every(d => Math.abs(d - 1 / RUN_SPEED) < 2 * frame)).toBe(true)
      expect(arrivals[0].running).toBe(false)
      expect(arrivals[arrivals.length - 1].running).toBe(true)
    })

    it('run → walk without stopping: the next tile walks', () => {
      const { arrivals } = drive(t => t < 1.1, 2.5)
      const times = tileTimes(arrivals)
      expect(times.slice(0, 4).every(d => Math.abs(d - 1 / RUN_SPEED) < 2 * frame)).toBe(true)
      expect(times.slice(-2).every(d => Math.abs(d - 1 / WALK_SPEED) < 2 * frame)).toBe(true)
      expect(arrivals[arrivals.length - 1].running).toBe(false)
    })

    it('never changes pace halfway through a tile, and each arrival reports the pace it was walked at', () => {
      const flicker = (t: number) => Math.floor(t / 0.09) % 2 === 0
      const { arrivals, speeds } = drive(flicker, 3)
      for (const tile of speeds.slice(1, -1)) expect(new Set(tile).size).toBe(1)
      for (const arrival of arrivals) expect(arrival.running).toBe(speeds[arrival.tx][0] === RUN_SPEED)
    })
  })

  it('walks in place against obstacles and alternates feet across tiles', () => {
    const wall: MoveRules = { blocked: (_a, tx) => tx === 2, occupied: () => false }
    const actor = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, dir: 'right', speed: WALK_SPEED })
    const state = createWalkerState()
    const feet = new Set<number>()
    for (let t = 0; t < 0.5; t += frame) {
      driveWalker(actor, 'right', frame, wall, state)
      feet.add(walkFrame(actor))
    }
    expect(feet.has(1) && feet.has(3)).toBe(true)
    expect(actor.tx).toBe(1)
    hold(actor, 'right', 0.5, wall, state)
    expect(actor.bumping).toBe(true)
    hold(actor, null, frame, wall, state)
    expect(actor.bumping).toBe(false)
    expect(walkFrame(actor)).toBe(0)
  })
})

describe('overworld sheets', () => {
  it('resolves bundled sheet paths with zero-padded ids', () => {
    expect(overworldSheetUrl(25, false)).toBe('/assets/overworld/0025.png')
    expect(overworldSheetUrl(384, true)).toBe('/assets/overworld/shiny/0384.png')
  })
})

describe('population typing', () => {
  it('normalises Spanish and English type names', () => {
    expect(normaliseType('Agua')).toBe('water')
    expect(normaliseType('Eléctrico')).toBe('electric')
    expect(normaliseType('rock')).toBe('rock')
    expect(normaliseType(null)).toBeNull()
  })

  it('matches biome candidates on either type', () => {
    const dex: PokedexEntry[] = [
      { id: 1, name_es: 'A', type1: 'Planta', type2: null, sprite_url: 'a.png' },
      { id: 2, name_es: 'B', type1: 'Normal', type2: 'Tierra', sprite_url: 'b.png' },
      { id: 3, name_es: 'C', type1: 'Roca', type2: null, sprite_url: null },
    ]
    expect(candidatesFor('desert', dex).map(p => p.id)).toEqual([2, 3])
  })
})
