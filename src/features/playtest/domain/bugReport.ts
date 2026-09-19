// The payload behind the REPORTAR BUG button.
//
// Built here, as a pure function, for one reason: a report is copied to the
// clipboard and pasted somewhere public, so what it may contain is a product
// decision and deserves a test. It carries where the player was and what the
// build was. It carries **no** session: no token, no access token, no refresh
// token, no user id, no e-mail, no Supabase key, no cookie, no URL query.
//
// The user id is left out on purpose even though it would help: the player is
// pasting this into a public chat.

export type BugCategory = 'BUG' | 'CONFUSO' | 'MEJORARIA'

export const BUG_CATEGORIES: readonly BugCategory[] = ['BUG', 'CONFUSO', 'MEJORARIA']

export const CATEGORY_LABEL: Readonly<Record<BugCategory, string>> = {
  BUG: 'Bug — algo se rompió',
  CONFUSO: 'Confuso — no entendí qué hacer',
  MEJORARIA: 'Mejoraría — funciona, pero…',
}

/** Long enough to describe a bug, short enough that nobody pastes a log dump. */
export const MAX_REPORT_LENGTH = 600

export interface BugReportInput {
  readonly category: BugCategory
  readonly text: string
  readonly buildLabel: string
  /** Where the player was: area id and tile, or null outside the world. */
  readonly area: string | null
  readonly tx: number | null
  readonly ty: number | null
  /** Which surface was on top: `dungeon`, `tienda`, `centro`, `chat`… */
  readonly surface: string | null
  readonly viewport: { readonly width: number; readonly height: number }
  readonly userAgent: string
  readonly at: number
}

export interface BugReport {
  readonly category: BugCategory
  readonly text: string
  readonly build: string
  readonly area: string
  readonly surface: string
  readonly viewport: string
  readonly browser: string
  readonly at: string
}

/**
 * A user agent is long, and most of it is noise. This keeps the engine and the
 * platform — enough to reproduce — and drops the rest.
 */
export function shortBrowser(userAgent: string): string {
  const engine = /(Firefox|Edg|OPR|Chrome|Safari)\/([\d.]+)/.exec(userAgent)
  const platform = /\(([^)]*)\)/.exec(userAgent)?.[1]?.split(';')[0]?.trim()
  const name = engine ? `${engine[1] === 'Edg' ? 'Edge' : engine[1]} ${engine[2].split('.')[0]}` : 'desconocido'
  return platform ? `${name} · ${platform}` : name
}

export function buildBugReport(input: BugReportInput): BugReport {
  const text = input.text.trim().slice(0, MAX_REPORT_LENGTH)
  const place = input.area === null
    ? 'fuera del mundo'
    : input.tx === null || input.ty === null ? input.area : `${input.area} (${input.tx}, ${input.ty})`
  return {
    category: input.category,
    text,
    build: input.buildLabel,
    area: place,
    surface: input.surface ?? '—',
    viewport: `${input.viewport.width}×${input.viewport.height}`,
    browser: shortBrowser(input.userAgent),
    at: new Date(input.at).toISOString(),
  }
}

/** The clipboard form: plain text, because it is pasted into a chat. */
export function formatBugReport(report: BugReport): string {
  return [
    `[${report.category}] ${report.build}`,
    `Dónde: ${report.area}`,
    `Pantalla: ${report.surface}`,
    `Viewport: ${report.viewport}`,
    `Navegador: ${report.browser}`,
    `Cuándo: ${report.at}`,
    '',
    report.text || '(sin descripción)',
  ].join('\n')
}
