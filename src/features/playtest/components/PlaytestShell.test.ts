import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./PlaytestShell.vue', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]

describe('playtest shell', () => {
  it('does not mount or bundle the in-game bug report button', () => {
    expect(source).not.toContain('BugReportButton')
  })
})
