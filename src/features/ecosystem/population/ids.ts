// Encounter and group identities (ECO-2A).
//
//   group     = `<namespace>:<areaId>:<nestId>:<generation>`
//   encounter = `<group>:<member>`
//
// Unique within ONE namespace because a nest's generation only grows. Across
// restarts or instances the namespace must change (or the generations must be
// restored): that is the future authority's job, not this module's.

export const nestKey = (areaId: string, nestId: string): string => `${areaId}/${nestId}`

export const groupIdOf = (namespace: string, areaId: string, nestId: string, generation: number): string =>
  `${namespace}:${areaId}:${nestId}:${generation}`

export interface EncounterIdParts {
  readonly namespace: string
  readonly areaId: string
  readonly nestId: string
  readonly generation: number
  readonly member: number
}

const COUNTER = /^(0|[1-9][0-9]*)$/

/** Parses an encounter id; null when it is not one. */
export function encounterIdParts(id: string): EncounterIdParts | null {
  if (typeof id !== 'string') return null
  const parts = id.split(':')
  if (parts.length !== 5 || parts.slice(0, 3).some(part => part.length === 0)) return null
  const [namespace, areaId, nestId, generation, member] = parts
  if (!COUNTER.test(generation) || !COUNTER.test(member)) return null
  return { namespace, areaId, nestId, generation: Number(generation), member: Number(member) }
}
