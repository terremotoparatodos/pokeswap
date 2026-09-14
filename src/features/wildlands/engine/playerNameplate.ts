const MAX_WIDTH_CSS_PX = 144
const FONT_CSS_PX = 12
const PAD_X_CSS_PX = 6
const PAD_Y_CSS_PX = 3

/** Draws an untrusted username as canvas text; the string is never parsed as markup. */
export function drawPlayerNameplate(
  ctx: CanvasRenderingContext2D,
  username: string,
  x: number,
  y: number,
  dpr: number,
): void {
  const maxWidth = MAX_WIDTH_CSS_PX * dpr
  const fontSize = FONT_CSS_PX * dpr
  const padX = PAD_X_CSS_PX * dpr
  const padY = PAD_Y_CSS_PX * dpr
  ctx.save()
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const textWidth = Math.min(maxWidth, ctx.measureText(username).width)
  const width = textWidth + padX * 2
  const height = fontSize + padY * 2
  ctx.fillStyle = 'rgba(15, 26, 51, 0.82)'
  ctx.fillRect(Math.round(x - width / 2), Math.round(y - height), Math.round(width), Math.round(height))
  ctx.strokeStyle = 'rgba(223, 232, 255, 0.55)'
  ctx.lineWidth = Math.max(1, dpr)
  ctx.strokeRect(Math.round(x - width / 2), Math.round(y - height), Math.round(width), Math.round(height))
  ctx.fillStyle = '#ffffff'
  ctx.fillText(username, x, y - padY, maxWidth)
  ctx.restore()
}
