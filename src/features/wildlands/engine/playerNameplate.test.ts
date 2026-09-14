import { describe, expect, it, vi } from 'vitest'
import { drawPlayerNameplate } from './playerNameplate'

describe('player nameplate', () => {
  it('passes hostile usernames verbatim to fillText and never interprets markup', () => {
    const hostile = '<img src=x onerror=alert(1)> שלום'
    const ctx = {
      save: vi.fn(), restore: vi.fn(), measureText: vi.fn(() => ({ width: 400 })),
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    } as unknown as CanvasRenderingContext2D
    drawPlayerNameplate(ctx, hostile, 100, 50, 2)
    expect(ctx.fillText).toHaveBeenCalledWith(hostile, 100, expect.any(Number), 288)
  })
})
