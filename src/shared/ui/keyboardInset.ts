/**
 * Where the on-screen keyboard leaves room for a text field (MOBILE-1): the
 * chat, the sign-in form and the bug report.
 *
 * iOS Safari keeps `position: fixed` on the layout viewport: the keyboard
 * only shrinks the visual viewport, so a box fixed to the bottom ends up
 * behind it. While active this publishes, on the root element:
 *   --keyboard-inset   px of the layout viewport's bottom the keyboard covers
 *   --visible-height   px of the viewport still visible
 * CSS then lifts the surface above the keyboard. Without visualViewport (old
 * browsers, jsdom) nothing is published and the CSS fallbacks apply.
 *
 * Several surfaces may track at once; the variables go away with the last one.
 */
const active = new WeakMap<Window, number>()

export function trackKeyboardInset(target: Window = window): () => void {
  const viewport = target.visualViewport
  if (!viewport) return () => {}
  const root = target.document.documentElement
  const update = () => {
    const covered = Math.max(0, target.innerHeight - viewport.height - viewport.offsetTop)
    root.style.setProperty('--keyboard-inset', `${Math.round(covered)}px`)
    root.style.setProperty('--visible-height', `${Math.round(viewport.height)}px`)
  }
  active.set(target, (active.get(target) ?? 0) + 1)
  update()
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    const left = (active.get(target) ?? 1) - 1
    active.set(target, left)
    if (left > 0) return
    root.style.removeProperty('--keyboard-inset')
    root.style.removeProperty('--visible-height')
  }
}
