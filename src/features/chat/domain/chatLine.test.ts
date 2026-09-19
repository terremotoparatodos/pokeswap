import { describe, expect, it } from 'vitest'
import {
  CLIENT_CHAT_HISTORY, MAX_CHAT_LENGTH, appendLine, draftToSend, formatTime, mergeHistory, parseChatLine,
  type ChatLine,
} from './chatLine'

const line = (over: Partial<ChatLine> = {}): ChatLine => ({
  id: 'u1:1', areaId: 'pradera', from: 'u1', username: 'Ash', text: 'hola', at: 1_000, ...over,
})

describe('draftToSend', () => {
  it('refuses an empty draft so Enter on nothing does nothing', () => {
    expect(draftToSend('')).toBeNull()
    expect(draftToSend('    ')).toBeNull()
    expect(draftToSend('\n\t')).toBeNull()
  })

  it('collapses whitespace and caps the length', () => {
    expect(draftToSend('  hola   mundo ')).toBe('hola mundo')
    expect(draftToSend('x'.repeat(MAX_CHAT_LENGTH + 20))).toHaveLength(MAX_CHAT_LENGTH)
  })

  it('counts characters, not code units, so an emoji is never cut in half', () => {
    const sent = draftToSend('🙂'.repeat(MAX_CHAT_LENGTH + 5)) ?? ''
    expect([...sent]).toHaveLength(MAX_CHAT_LENGTH)
    expect(sent).not.toContain('�')
  })
})

describe('parseChatLine', () => {
  it('accepts a well-formed line', () => {
    expect(parseChatLine(line())).toEqual(line())
  })

  it('rejects anything that is not one, rather than rendering junk', () => {
    expect(parseChatLine(null)).toBeNull()
    expect(parseChatLine('hola')).toBeNull()
    expect(parseChatLine({ id: 'a', text: 'x' })).toBeNull()
    expect(parseChatLine({ id: 1, text: 'x', username: 'a', areaId: 'p' })).toBeNull()
  })

  it('keeps the text exactly as the server accepted it, markup and all', () => {
    // The server does not strip angle brackets, and neither does this: the
    // renderer escapes. "3 < 5" has to survive the round trip.
    const hostile = parseChatLine(line({ text: '<img src=x onerror=alert(1)> 3 < 5' }))
    expect(hostile?.text).toBe('<img src=x onerror=alert(1)> 3 < 5')
  })
})

describe('appendLine', () => {
  it('adds a line', () => {
    expect(appendLine([], line()).map(entry => entry.text)).toEqual(['hola'])
  })

  it('ignores a line it already has, so a history replay is idempotent', () => {
    const first = appendLine([], line())
    expect(appendLine(first, line())).toHaveLength(1)
    expect(appendLine(first, line({ id: 'u1:2' }))).toHaveLength(2)
  })

  it('keeps the log bounded', () => {
    let log: ChatLine[] = []
    for (let i = 0; i < CLIENT_CHAT_HISTORY + 25; i++) log = appendLine(log, line({ id: `u1:${i}`, at: i }))
    expect(log).toHaveLength(CLIENT_CHAT_HISTORY)
    expect(log[0].id).toBe(`u1:${25}`)
  })
})

describe('mergeHistory', () => {
  it('puts the conversation back in time order', () => {
    const merged = mergeHistory([], [
      line({ id: 'u1:3', at: 300, text: 'tres' }),
      line({ id: 'u1:1', at: 100, text: 'uno' }),
      line({ id: 'u1:2', at: 200, text: 'dos' }),
    ])
    expect(merged.map(entry => entry.text)).toEqual(['uno', 'dos', 'tres'])
  })

  it('does not double up what is already on screen after a reconnect', () => {
    const onScreen = [line({ id: 'u1:1', at: 100 }), line({ id: 'u1:2', at: 200 })]
    const merged = mergeHistory(onScreen, [line({ id: 'u1:2', at: 200 }), line({ id: 'u1:3', at: 300 })])
    expect(merged.map(entry => entry.id)).toEqual(['u1:1', 'u1:2', 'u1:3'])
  })
})

describe('formatTime', () => {
  it('shows the clock, because a playtest lasts two hours', () => {
    expect(formatTime(new Date(2026, 8, 19, 9, 5).getTime())).toBe('09:05')
    expect(formatTime(new Date(2026, 8, 19, 21, 40).getTime())).toBe('21:40')
  })
})
