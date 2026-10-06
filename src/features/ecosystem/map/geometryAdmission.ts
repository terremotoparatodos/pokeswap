// Admission trusts the reviewed build artifact, never a caller-supplied copy,
// hash, brand or version label. map-geometry.mjs --check and validate-inputs.ts
// independently compare this artifact with the actual authoritative world modules.
// Raw text is an immutable build value: mutating the shared JSON object cannot
// mutate this reference. No Node/server imports, I/O, clock or RNG at runtime.
import authoredText from './generated/geometrySnapshot.json?raw'
import type { GeometrySnapshot } from './geometry'

/** Object key order is irrelevant; all fields, array order and values are checked. */
function content(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(content).join(',')}]`
  const fields = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(fields).sort().map(key => `${JSON.stringify(key)}:${content(fields[key])}`).join(',')}}`
}

const authoredContent = content(JSON.parse(authoredText)) // private immutable string, not caller-controlled data

/** Supports exactly the independently verified geometry of this build. */
export function geometryMatchesBuild(snapshot: GeometrySnapshot): boolean {
  return content(snapshot) === authoredContent
}
