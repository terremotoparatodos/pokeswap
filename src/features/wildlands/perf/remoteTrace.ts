// Remote players as this client receives and draws them (PERF-1). Observes only.
//
// Answers, per remote actor: did its sprite disappear or change because
// network data was missing, because the actor object was rebuilt, because the
// sheet was not loaded (fallback art), or because the renderer dropped it?
// Four sources feed it: presence messages (adapter port wrapper), every frame's
// remote actor list, the renderer's per-actor outcome and trainer-sheet loads.

import type { Actor } from '../engine/actors'
import type { TrainerSprites } from '../engine/characters'
import type { RemotePresenceActor } from '../multiplayer/domain/presence'
import { TILE } from '../engine/world'
import { SampleRing, summarize, type Summary } from './stats'

/** What the renderer did with an actor this frame. */
export type DrawOutcome = 'drawn' | 'culled' | 'noArt'

/** A remote is waiting for data if it rests for less than this before its next step. */
const STOP_AND_GO_MS = 400

interface Track {
  actor: Actor
  createdAt: number
  sheetAt: number | null
  trainer: TrainerSprites | undefined
  x: number
  y: number
  moving: boolean
  restingSince: number | null
  lastReceiveAt: number | null
  lastTx: number
  lastTy: number
  lastSeq: number
  removedAt: number | null
}

export interface RemoteReport {
  receive: {
    updates: number
    snapshots: number
    removals: number
    intervalMs: Summary
    tileDistance: { same: number; one: number; two: number; threeOrMore: number }
    sequenceGaps: number
  }
  lifecycle: {
    created: number
    destroyed: number
    /** Same presence id, new actor object (after leaving and coming back). */
    recreated: number
    /** Recreated less than 2 s after being removed: interest-boundary flapping. */
    recreatedWithin2s: number
    maxConcurrent: number
    concurrentPerFrame: Summary
  }
  sprites: {
    /** Fallback art replaced by the character sheet: expected once per new actor. */
    fallbackToSheet: number
    fallbackToSheetMs: Summary
    /** A loaded sheet replaced by the fallback art again: should never happen. */
    sheetToFallback: number
    /** One loaded sheet replaced by another (character change). */
    sheetToSheet: number
    /** Frames drawn with fallback art more than 2 s after the actor appeared. */
    stuckFallbackFrames: number
    /** Frames running without run frames in the sheet (walk cycle used instead). */
    runWithoutRunFrames: number
    drawn: number
    culled: number
    /** The renderer found neither trainer nor Pokémon art: an invisible actor. */
    noArt: number
    sheetRequests: number
    sheetCacheHits: number
    sheetLoads: number
    sheetFailures: number
    sheetLoadMs: Summary
  }
  motion: {
    snaps: number
    maxSnapTiles: number
    /** Rests shorter than 400 ms between two steps: the remote waited for data. */
    stopAndGo: number
    stopAndGoMs: Summary
  }
}

export class RemoteTrace {
  private readonly tracks = new Map<string, Track>()
  private readonly removed = new Map<string, number>()
  private readonly intervals = new SampleRing(50_000)
  private readonly sheetLatency = new SampleRing(5_000)
  private readonly loadMs = new SampleRing(5_000)
  private readonly waits = new SampleRing(50_000)
  private readonly concurrent = new SampleRing(36_000)
  private readonly pendingLoads = new Map<string, number>()
  private r = this.emptyReport()

  constructor(private readonly now: () => number = () => performance.now()) {}

  private emptyReport(): RemoteReport {
    const empty = summarize([])
    return {
      receive: { updates: 0, snapshots: 0, removals: 0, intervalMs: empty, tileDistance: { same: 0, one: 0, two: 0, threeOrMore: 0 }, sequenceGaps: 0 },
      lifecycle: { created: 0, destroyed: 0, recreated: 0, recreatedWithin2s: 0, maxConcurrent: 0, concurrentPerFrame: empty },
      sprites: {
        fallbackToSheet: 0, fallbackToSheetMs: empty, sheetToFallback: 0, sheetToSheet: 0, stuckFallbackFrames: 0,
        runWithoutRunFrames: 0, drawn: 0, culled: 0, noArt: 0, sheetRequests: 0, sheetCacheHits: 0, sheetLoads: 0,
        sheetFailures: 0, sheetLoadMs: empty,
      },
      motion: { snaps: 0, maxSnapTiles: 0, stopAndGo: 0, stopAndGoMs: empty },
    }
  }

  clear(): void {
    this.r = this.emptyReport()
    for (const ring of [this.intervals, this.sheetLatency, this.loadMs, this.waits, this.concurrent]) ring.clear()
    this.removed.clear()
    this.pendingLoads.clear()
    // Tracks stay: actors on screen keep their identity across a new capture.
  }

  // ── network side (wrapped presence port) ──

  received(remote: RemotePresenceActor): void {
    const at = this.now()
    this.r.receive.updates++
    const track = this.tracks.get(remote.id)
    if (track && track.lastReceiveAt !== null) {
      this.intervals.push(at - track.lastReceiveAt)
      const d = Math.abs(remote.tx - track.lastTx) + Math.abs(remote.ty - track.lastTy)
      const bucket = this.r.receive.tileDistance
      if (d === 0) bucket.same++; else if (d === 1) bucket.one++; else if (d === 2) bucket.two++; else bucket.threeOrMore++
      if (remote.moveSequence - track.lastSeq > 1) this.r.receive.sequenceGaps++
    }
    if (track) {
      track.lastReceiveAt = at; track.lastTx = remote.tx; track.lastTy = remote.ty; track.lastSeq = remote.moveSequence
    } else {
      this.pendingFirst.set(remote.id, { at, tx: remote.tx, ty: remote.ty, seq: remote.moveSequence })
    }
  }

  /** First message of an actor not yet on screen: attached when its actor object appears. */
  private readonly pendingFirst = new Map<string, { at: number; tx: number; ty: number; seq: number }>()

  snapshot(count: number): void {
    this.r.receive.snapshots++
    this.r.receive.updates += count
  }

  removedByNetwork(): void {
    this.r.receive.removals++
  }

  // ── trainer sheets (characters.ts probe) ──

  sheetRequested(url: string, cached: boolean): void {
    this.r.sprites.sheetRequests++
    if (cached) this.r.sprites.sheetCacheHits++
    else this.pendingLoads.set(url, this.now())
  }

  sheetSettled(url: string, ok: boolean): void {
    const started = this.pendingLoads.get(url)
    this.pendingLoads.delete(url)
    if (!ok) { this.r.sprites.sheetFailures++; return }
    this.r.sprites.sheetLoads++
    if (started !== undefined) this.loadMs.push(this.now() - started)
  }

  // ── renderer probe ──

  drawOutcome(actor: Actor, outcome: DrawOutcome): void {
    if (!actor.remote || actor.kind !== 'remote') return
    this.r.sprites[outcome]++
  }

  // ── every frame ──

  frame(remotes: readonly Actor[], fallback: TrainerSprites): void {
    const at = this.now()
    const seen = new Set<string>()
    for (const actor of remotes) {
      const id = actor.id.startsWith('remote:') ? actor.id.slice(7) : actor.id
      seen.add(id)
      let track = this.tracks.get(id)
      if (!track || track.actor !== actor) {
        const removedAt = this.removed.get(id)
        if (track || removedAt !== undefined) {
          this.r.lifecycle.recreated++
          if (removedAt !== undefined && at - removedAt < 2000) this.r.lifecycle.recreatedWithin2s++
        }
        this.r.lifecycle.created++
        const first = this.pendingFirst.get(id)
        this.pendingFirst.delete(id)
        track = {
          actor, createdAt: at, sheetAt: actor.trainer === fallback ? null : at, trainer: actor.trainer,
          x: 0, y: 0, moving: actor.progress < 1, restingSince: null,
          lastReceiveAt: first?.at ?? track?.lastReceiveAt ?? null, lastTx: first?.tx ?? actor.tx, lastTy: first?.ty ?? actor.ty,
          lastSeq: first?.seq ?? track?.lastSeq ?? 0, removedAt: null,
        }
        const p = position(actor)
        track.x = p.x; track.y = p.y
        this.tracks.set(id, track)
        this.removed.delete(id)
        continue
      }
      // Sprite identity.
      if (actor.trainer !== track.trainer) {
        const wasFallback = track.trainer === fallback
        const isFallback = actor.trainer === fallback
        if (wasFallback && !isFallback) { this.r.sprites.fallbackToSheet++; this.sheetLatency.push(at - track.createdAt); track.sheetAt = at }
        else if (!wasFallback && isFallback) this.r.sprites.sheetToFallback++
        else this.r.sprites.sheetToSheet++
        track.trainer = actor.trainer
      }
      if (actor.trainer === fallback && at - track.createdAt > 2000) this.r.sprites.stuckFallbackFrames++
      const moving = actor.progress < 1
      if (moving && actor.running && !actor.trainerRun) this.r.sprites.runWithoutRunFrames++
      // Movement continuity.
      const p = position(actor)
      const jump = Math.abs(p.x - track.x) + Math.abs(p.y - track.y)
      if (jump > TILE / 2) {
        this.r.motion.snaps++
        this.r.motion.maxSnapTiles = Math.max(this.r.motion.maxSnapTiles, Math.round(jump / TILE))
      }
      if (!moving && track.moving) track.restingSince = at
      if (moving && !track.moving && track.restingSince !== null) {
        const rest = at - track.restingSince
        if (rest < STOP_AND_GO_MS) { this.r.motion.stopAndGo++; this.waits.push(rest) }
        track.restingSince = null
      }
      track.x = p.x; track.y = p.y; track.moving = moving
    }
    for (const [id, track] of this.tracks) {
      if (seen.has(id)) continue
      this.r.lifecycle.destroyed++
      track.removedAt = at
      this.removed.set(id, at)
      this.tracks.delete(id)
    }
    this.concurrent.push(remotes.length)
    this.r.lifecycle.maxConcurrent = Math.max(this.r.lifecycle.maxConcurrent, remotes.length)
  }

  report(): RemoteReport {
    const r = structuredClone(this.r)
    r.receive.intervalMs = summarize(this.intervals.values())
    r.lifecycle.concurrentPerFrame = summarize(this.concurrent.values())
    r.sprites.fallbackToSheetMs = summarize(this.sheetLatency.values())
    r.sprites.sheetLoadMs = summarize(this.loadMs.values())
    r.motion.stopAndGoMs = summarize(this.waits.values())
    return r
  }
}

function position(actor: Actor): { x: number; y: number } {
  const t = actor.progress
  return { x: (actor.fromTx + (actor.tx - actor.fromTx) * t) * TILE, y: (actor.fromTy + (actor.ty - actor.fromTy) * t) * TILE }
}
