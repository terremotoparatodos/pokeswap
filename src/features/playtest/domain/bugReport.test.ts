import { describe, expect, it } from 'vitest'
import { buildBugReport, formatBugReport, MAX_REPORT_LENGTH, shortBrowser, type BugReportInput } from './bugReport'

const input = (over: Partial<BugReportInput> = {}): BugReportInput => ({
  category: 'BUG',
  text: 'la cueva no abre',
  buildLabel: 'Community Playtest 0.2 · a1b2c3d',
  area: 'pradera',
  tx: -5,
  ty: -69,
  surface: 'wildlands',
  viewport: { width: 375, height: 812 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  at: Date.UTC(2026, 8, 19, 3, 0, 0),
  ...over,
})

describe('buildBugReport', () => {
  it('names the build, the place and the tile', () => {
    const report = buildBugReport(input())
    expect(report.build).toBe('Community Playtest 0.2 · a1b2c3d')
    expect(report.area).toBe('pradera (-5, -69)')
    expect(report.viewport).toBe('375×812')
  })

  it('survives being outside the world', () => {
    expect(buildBugReport(input({ area: null, tx: null, ty: null })).area).toBe('fuera del mundo')
    expect(buildBugReport(input({ tx: null, ty: null })).area).toBe('pradera')
    expect(buildBugReport(input({ surface: null })).surface).toBe('—')
  })

  it('trims and caps the text so nobody pastes a log dump', () => {
    const report = buildBugReport(input({ text: `  ${'x'.repeat(MAX_REPORT_LENGTH + 50)}  ` }))
    expect(report.text).toHaveLength(MAX_REPORT_LENGTH)
  })

  it('carries no session: the report is pasted in public', () => {
    const serialized = formatBugReport(buildBugReport(input({
      text: 'algo raro',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0',
    })))
    for (const secret of ['token', 'Bearer', 'access_token', 'refresh', 'apikey', 'supabase', '@']) {
      expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase())
    }
  })
})

describe('shortBrowser', () => {
  it('keeps the engine and the platform, drops the rest', () => {
    expect(shortBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'))
      .toBe('Chrome 131 · Windows NT 10.0')
    expect(shortBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'))
      .toContain('Macintosh')
    expect(shortBrowser('something entirely unexpected')).toBe('desconocido')
  })

  it('spells Edge as Edge rather than Edg', () => {
    expect(shortBrowser('Mozilla/5.0 (Windows NT 10.0) Edg/131.0.0.0')).toContain('Edge 131')
  })
})
