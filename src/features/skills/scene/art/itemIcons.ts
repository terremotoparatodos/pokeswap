// One icon per material, whatever kit draws it.

import { cropIconArt } from './cropItems'
import { loggingResourceIconArt } from './loggingItems'
import { resourceIconArt } from './miningItems'
import { toDataUrl, type PixelArt } from './pixelArt'

export function itemIconArt(itemId: string): PixelArt | null {
  return resourceIconArt(itemId) ?? loggingResourceIconArt(itemId) ?? cropIconArt(itemId)
}

const urls = new Map<string, string | null>()
let canvasReady: boolean | null = null

/** False where there is no 2D canvas (tests, very old browsers): the UI falls back to a letter. */
function canDraw(): boolean {
  canvasReady ??= typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d')
  return canvasReady
}

/** Data URL for an <img>, cached; null for an unknown item or without a canvas. */
export function itemIconUrl(itemId: string, scale = 2): string | null {
  if (!canDraw()) return null
  const key = `${itemId}|${scale}`
  if (!urls.has(key)) {
    const art = itemIconArt(itemId)
    urls.set(key, art ? toDataUrl(art, scale) : null)
  }
  return urls.get(key)!
}
