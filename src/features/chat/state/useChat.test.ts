import { describe, expect, it, vi } from 'vitest'
import { useChat } from './useChat'

describe('live chat delivery', () => {
  it('adds one server line to the log and announces that same line for the actor bubble', () => {
    const chat = useChat()
    const bubble = vi.fn()
    const stop = chat.subscribe(bubble)
    const line = { id: 'bubble-user:1', areaId: 'ciudad-corazon', from: 'bubble-user', username: 'Misty', text: 'hola ciudad', at: 1 }

    chat.sink.line(line)
    chat.sink.line(line)

    expect(chat.lines.value.filter(entry => entry.id === line.id)).toEqual([line])
    expect(bubble).toHaveBeenCalledOnce()
    expect(bubble).toHaveBeenCalledWith(line)
    stop()
  })
})
