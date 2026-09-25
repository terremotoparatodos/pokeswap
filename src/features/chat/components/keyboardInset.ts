/**
 * Where the on-screen keyboard leaves room for the chat (MOBILE-1).
 *
 * iOS Safari keeps `position: fixed` on the layout viewport: the keyboard
 * only shrinks the visual viewport, so a box fixed to the bottom ends up
 * behind it. While active this publishes, on the root element:
 *   --keyboard-inset   px of the layout viewport's bottom the keyboard covers
 *   --visible-height   px of the viewport still visible
 * CSS then lifts the chat above the keyboard. Without visualViewport (old
 * browsers, jsdom) nothing is published and the CSS fallbacks apply.
 */
export function trackKeyboardInset(target: Window = window): () => void {
  const viewport = target.visualViewport
  if (!viewport) return () => {}
  const root = target.document.documentElement
  const update = () => {
    const covered = Math.max(0, target.innerHeight - viewport.height - viewport.offsetTop)
    root.style.setProperty('--keyboard-inset', `${Math.round(covered)}px`)
    root.style.setProperty('--visible-height', `${Math.round(viewport.height)}px`)
  }
  update()
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    root.style.removeProperty('--keyboard-inset')
    root.style.removeProperty('--visible-height')
  }
}
