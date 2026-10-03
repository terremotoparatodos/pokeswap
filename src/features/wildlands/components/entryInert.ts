// PRESENCE UX-1 — while the world-entry overlay covers the world, everything
// it covers is out of reach: not clickable (the overlay takes the pointer),
// not focusable and not reachable with Tab (`inert`). Only a modal dialog
// that sits above the overlay (sign-in) stays usable.

const isModal = (element: Element) =>
  element.matches('[aria-modal="true"]') || element.querySelector('[aria-modal="true"]') !== null

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
    if (!(node instanceof HTMLElement) || node === cover || node.hasAttribute('inert') || isModal(node)) return
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
