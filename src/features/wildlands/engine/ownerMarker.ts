// Owner marker — WildLands lobby (R26)
//
// A small bobbing diamond over the viewer's own Pokémon, so they stand out in
// the plaza. Shiny sparkles already mean "shiny", so ownership uses a shape.

const FILL = '#ffd23f'
const EDGE = '#1c1c24'

/** Draws the marker centred on `x`, just above `top` (screen px); `s` is the sprite scale. */
export function drawOwnerMarker(ctx: CanvasRenderingContext2D, x: number, top: number, s: number, seconds: number): void {
  const u = Math.max(1.5, s)
  const cy = Math.round(top - u * 9 + Math.sin(seconds * 4) * u * 1.5)
  const cx = Math.round(x)
  const diamond = (r: number) => {
    const w = Math.round(r * 0.75)
    const h = Math.round(r)
    ctx.beginPath()
    ctx.moveTo(cx, cy - h)
    ctx.lineTo(cx + w, cy)
    ctx.lineTo(cx, cy + h)
    ctx.lineTo(cx - w, cy)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = EDGE
  diamond(u * 7)
  ctx.fillStyle = FILL
  diamond(u * 5)
}
