import { describe, expect, it } from 'vitest'
import { wrapChatBubbleText } from './chatBubble'

describe('chat bubble text', () => {
  it('keeps a short server message intact', () => {
    expect(wrapChatBubbleText('hola ciudad')).toEqual(['hola ciudad'])
  })

  it('bounds long text above the actor and preserves whole unicode characters', () => {
    const lines = wrapChatBubbleText(`mensaje ${'🙂'.repeat(100)}`)
    expect(lines).toHaveLength(3)
    expect(lines.every(line => [...line].length <= 29)).toBe(true)
    expect(lines[lines.length - 1]?.endsWith('…')).toBe(true)
    expect(lines.join('')).not.toContain('�')
  })
})
