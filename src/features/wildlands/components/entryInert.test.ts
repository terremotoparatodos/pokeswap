import { afterEach, describe, expect, it } from 'vitest'
import { inertSiblings } from './entryInert'

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

  it('leaves a modal dialog usable and an already-inert element as it was', () => {
    const modal = element('div', {}, element('div', { role: 'dialog', 'aria-modal': 'true' }))
    const was = element('div', { inert: '' })
    const { cover } = layout(modal, was)
    const release = inertSiblings(cover)
    expect(modal.hasAttribute('inert')).toBe(false)
    release()
    expect(was.hasAttribute('inert')).toBe(true)
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
