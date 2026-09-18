// A small RFC-4180 reader for the source CSVs (R32.1).
//
// Written by hand on purpose: the pipeline must run with no dependency beyond
// what the repo already has, and some of these tables carry quoted fields with
// embedded newlines and commas (`growth_rates.csv` holds LaTeX formulas).

/** Parses a CSV document into rows of raw string cells. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(cell); cell = ''; continue }
    if (char === '\r') continue
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += char
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/** Parses a CSV into objects keyed by its header row. */
export function readTable(text) {
  const rows = parseCsv(text)
  const header = rows.shift()
  if (!header) return []
  return rows
    .filter(row => row.length === header.length)
    .map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])))
}

/** `''` means "no value" in these tables; everything else is a number. */
export const num = value => (value === '' || value === undefined ? null : Number(value))

/** Groups rows by a key, preserving file order inside each group. */
export function groupBy(rows, key) {
  const out = new Map()
  for (const row of rows) {
    const id = typeof key === 'function' ? key(row) : row[key]
    const list = out.get(id)
    if (list) list.push(row)
    else out.set(id, [row])
  }
  return out
}
