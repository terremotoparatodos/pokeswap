/** Canvas-only chat balloon. Text never becomes HTML. */

export function wrapChatBubbleText(text: string, maxCharacters = 28, maxLines = 3): string[] {
  const characters = [...text.replace(/\s+/g, ' ').trim()]
  const lines: string[] = []
  while (characters.length && lines.length < maxLines) {
    let take = Math.min(maxCharacters, characters.length)
    if (take < characters.length) {
      const space = characters.slice(0, take + 1).lastIndexOf(' ')
      if (space > Math.floor(maxCharacters / 2)) take = space
    }
    const line = characters.splice(0, take).join('').trim()
    while (characters[0] === ' ') characters.shift()
    if (line) lines.push(line)
  }
  if (characters.length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/, '')}…`
  return lines
}

export function drawChatBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  anchorY: number,
  dpr: number,
): void {
  const lines = wrapChatBubbleText(text)
  if (!lines.length) return
  ctx.save()
  const fontSize = Math.max(11, Math.round(12 * dpr))
  const lineHeight = Math.round(fontSize * 1.25)
  const padX = 8 * dpr
  const padY = 5 * dpr
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`
  const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + padX * 2
  const height = lines.length * lineHeight + padY * 2
  const margin = 6 * dpr
  const left = Math.max(margin, Math.min(ctx.canvas.width - width - margin, x - width / 2))
  const top = Math.max(margin, anchorY - height - 8 * dpr)
  const tailX = Math.max(left + 10 * dpr, Math.min(left + width - 10 * dpr, x))
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
  ctx.strokeStyle = 'rgba(16, 26, 54, 0.95)'
  ctx.lineWidth = Math.max(1, 2 * dpr)
  ctx.beginPath()
  ctx.roundRect(left, top, width, height, 7 * dpr)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(tailX - 5 * dpr, top + height - 1)
  ctx.lineTo(tailX, top + height + 7 * dpr)
  ctx.lineTo(tailX + 5 * dpr, top + height - 1)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#101a36'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => ctx.fillText(line, left + padX, top + padY + index * lineHeight))
  ctx.restore()
}
