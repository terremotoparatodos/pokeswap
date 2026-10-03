import { afterEach, describe, expect, it } from 'vitest'
import { KEEP_INTERACTIVE, inertSiblings } from './entryInert'

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))
function element(tag: string, attributes: Record<string, string> = {}, ...children: Element[]): HTMLElement {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  node.append(...children)
  return node
}
/** A parent holding `siblings` and then the cover, like the overlay among what it covers. */
function layout(...siblings: Element[]): { parent: HTMLElement; cover: HTMLElement } {
  const cover = element('div', { id: 'cover' })
  const parent = element('div', { id: 'parent' }, ...siblings, cover)
  document.body.replaceChildren(parent)
  return { parent, cover }
}
afterEach(() => { document.body.replaceChildren() })

describe('inertSiblings (PRESENCE UX-1 R4)', () => {
  it('covers every sibling but itself, and gives them back', () => {
    const canvas = element('canvas', { tabindex: '0' })
    const button = element('button')
    const { cover } = layout(canvas, button)
    const release = inertSiblings(cover)
    expect(canvas.hasAttribute('inert')).toBe(true)
    expect(button.hasAttribute('inert')).toBe(true)
    expect(cover.hasAttribute('inert')).toBe(false)
    release()
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })

  it('keeps only the sibling marked KEEP_INTERACTIVE; being a dialog is not enough', () => {
    const kept = element('div', { [KEEP_INTERACTIVE]: '' }, element('button'))
    const dialog = element('div', {}, element('section', { role: 'dialog', 'aria-modal': 'true' }))
    const ownDialog = element('section', { role: 'dialog', 'aria-modal': 'true' })
    // A wrapper is judged by its own attribute: a marked descendant does not keep the HUD beside it.
    const wrapper = element('div', {}, element('button', { id: 'hud' }), element('div', { [KEEP_INTERACTIVE]: '' }))
    const { cover } = layout(kept, dialog, ownDialog, wrapper)
    const release = inertSiblings(cover)
    expect(kept.hasAttribute('inert')).toBe(false)
    expect(dialog.hasAttribute('inert')).toBe(true)
    expect(ownDialog.hasAttribute('inert')).toBe(true)
    expect(wrapper.hasAttribute('inert')).toBe(true)
    release()
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })

  it('gives back exactly what it took: an element that was inert before stays inert', () => {
    const was = element('div', { inert: '' })
    const other = element('div')
    const { cover } = layout(was, other)
    const release = inertSiblings(cover)
    expect(other.hasAttribute('inert')).toBe(true)
    release()
    expect(was.hasAttribute('inert')).toBe(true)
    expect(other.hasAttribute('inert')).toBe(false)
  })

  it('covers siblings added while active, and stops watching once released', async () => {
    const { parent, cover } = layout()
    const release = inertSiblings(cover)
    const late = parent.appendChild(element('button'))
    await flush()
    expect(late.hasAttribute('inert')).toBe(true)
    release()
    const after = parent.appendChild(element('button'))
    await flush()
    expect(after.hasAttribute('inert')).toBe(false)
    expect(late.hasAttribute('inert')).toBe(false)
  })

  it('takes the keyboard out of a subtree it covers', () => {
    const input = element('input') as HTMLInputElement
    const { cover } = layout(element('div', {}, input))
    input.focus()
    expect(document.activeElement).toBe(input)
    inertSiblings(cover)()
    expect(document.activeElement).not.toBe(input)
  })
})
