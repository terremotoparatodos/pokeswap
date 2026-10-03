// PRESENCE UX-1 — while the world-entry overlay covers the world, everything
// it covers is out of reach: not clickable (the overlay takes the pointer),
// not focusable and not reachable with Tab (`inert`). The one exception is
// the sign-in dialog, which sits above the overlay: WildlandsView marks its
// root with KEEP_INTERACTIVE. Being a dialog (`aria-modal`) is not enough:
// feature panels and plaza cards are dialogs too, and they sit under it.

/** Marks the single sibling that stays usable while the overlay shows. Read on the sibling itself only. */
export const KEEP_INTERACTIVE = 'data-world-entry-keep-interactive'

/**
 * Makes every sibling of `cover` inert, including siblings that appear while
 * it is active, and returns the function that gives them back. Elements that
 * were already inert are left as they were.
 */
export function inertSiblings(cover: HTMLElement): () => void {
  const parent = cover.parentElement
  if (!parent) return () => undefined
  const marked = new Set<HTMLElement>()
  const mark = (node: Node) => {
    if (!(node instanceof HTMLElement) || node === cover || node.hasAttribute('inert') || node.hasAttribute(KEEP_INTERACTIVE)) return
    node.setAttribute('inert', '')
    marked.add(node)
    // Focus inside a subtree that just went inert would keep receiving keys.
    if (node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }
  for (const child of Array.from(parent.children)) mark(child)
  const observer = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(mark)
  })
  observer.observe(parent, { childList: true })
  return () => {
    observer.disconnect()
    for (const element of marked) element.removeAttribute('inert')
    marked.clear()
  }
}
