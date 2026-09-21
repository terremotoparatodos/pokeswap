// Nameplates — Rancho
//
// The little label under each inhabitant: platform mark plus the name. They
// are drawn on the canvas, never as one DOM node per Pokémon — two thousand
// of those would sink the page. Each label is painted once into its own small
// canvas and reused every frame; only the labels actually on screen are ever
// built, and the cache is bounded.
//
// Names come from Twitch and YouTube, so they are untrusted text: they only
// ever reach fillText, which draws characters and interprets nothing.

import type { Platform } from '../domain/membership'

const FONT_PX = 11
const PAD_X = 5
const PAD_Y = 3
const MARK = 11
const GAP = 4
const RADIUS = 5
/** Labels kept around; a crowded screen shows far fewer than this. */
const MAX_CACHED = 400

export interface Nameplate {
  canvas: HTMLCanvasElement
  /** Size in CSS pixels. */
  w: number
  h: number
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Twitch's purple mark: the screen with its two indicators. */
function twitchMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#9146ff'
  ctx.beginPath()
  ctx.moveTo(x + s * 0.08, y + s * 0.2)
  ctx.lineTo(x + s * 0.2, y)
  ctx.lineTo(x + s, y)
  ctx.lineTo(x + s, y + s * 0.66)
  ctx.lineTo(x + s * 0.72, y + s * 0.94)
  ctx.lineTo(x + s * 0.5, y + s * 0.94)
  ctx.lineTo(x + s * 0.34, y + s)
  ctx.lineTo(x + s * 0.34, y + s * 0.94)
  ctx.lineTo(x + s * 0.08, y + s * 0.94)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x + s * 0.42, y + s * 0.26, s * 0.12, s * 0.34)
  ctx.fillRect(x + s * 0.68, y + s * 0.26, s * 0.12, s * 0.34)
}

/** YouTube's red mark: the rounded screen with a play triangle. */
function youtubeMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#ff0033'
  roundedRect(ctx, x, y + s * 0.16, s, s * 0.68, s * 0.22)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(x + s * 0.4, y + s * 0.33)
  ctx.lineTo(x + s * 0.4, y + s * 0.67)
  ctx.lineTo(x + s * 0.68, y + s * 0.5)
  ctx.closePath()
  ctx.fill()
}

export class NameplateCache {
  private readonly cache = new Map<string, Nameplate>()
  private dpr = 1
  private measure: CanvasRenderingContext2D | null = null

  /** Rebuilds everything when the screen density changes, so text stays sharp. */
  setDpr(dpr: number): void {
    if (dpr === this.dpr) return
    this.dpr = dpr
    this.cache.clear()
    this.measure = null
  }

  private font(scale: number): string {
    return `600 ${FONT_PX * scale}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  }

  get(key: string, name: string, platform: Platform, highlighted: boolean): Nameplate {
    const id = highlighted ? `!${key}` : key
    const existing = this.cache.get(id)
    if (existing) {
      // Refresh its place in the map so the oldest entry is the one dropped.
      this.cache.delete(id)
      this.cache.set(id, existing)
      return existing
    }
    const plate = this.paint(name, platform, highlighted)
    this.cache.set(id, plate)
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return plate
  }

  private paint(name: string, platform: Platform, highlighted: boolean): Nameplate {
    if (!this.measure) this.measure = document.createElement('canvas').getContext('2d')
    const probe = this.measure
    let textW = name.length * FONT_PX * 0.6
    if (probe) {
      probe.font = this.font(1)
      textW = probe.measureText(name).width
    }
    const w = Math.ceil(PAD_X * 2 + MARK + GAP + textW)
    const h = FONT_PX + PAD_Y * 2
    const scale = this.dpr
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(w * scale)
    canvas.height = Math.ceil(h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)

    ctx.fillStyle = highlighted ? 'rgba(255, 214, 92, 0.96)' : 'rgba(22, 22, 30, 0.72)'
    roundedRect(ctx, 0.5, 0.5, w - 1, h - 1, RADIUS)
    ctx.fill()
    ctx.strokeStyle = highlighted ? 'rgba(120, 78, 0, 0.9)' : 'rgba(0, 0, 0, 0.45)'
    ctx.lineWidth = 1
    ctx.stroke()

    const markY = (h - MARK) / 2
    if (platform === 'twitch') twitchMark(ctx, PAD_X, markY, MARK)
    else youtubeMark(ctx, PAD_X, markY, MARK)

    ctx.font = this.font(1)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = highlighted ? '#2a1d00' : '#ffffff'
    // Untrusted text: fillText draws glyphs and never parses markup.
    ctx.fillText(name, PAD_X + MARK + GAP, h / 2 + 0.5)

    return { canvas, w, h }
  }

  get size(): number {
    return this.cache.size
  }
}
