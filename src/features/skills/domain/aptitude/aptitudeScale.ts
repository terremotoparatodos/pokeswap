// Work aptitude: how good a species is at a kind of work, 1..5.
//
// Five steps because a player has to read it at a glance ("★★★★☆") and a
// designer has to patch it in one line. Every species is at least 1 in every
// skill: nobody is useless, which is what keeps a new player from being stuck.

export type Aptitude = 1 | 2 | 3 | 4 | 5

export const APTITUDES: readonly Aptitude[] = [1, 2, 3, 4, 5]

export const APTITUDE_LABEL: Readonly<Record<Aptitude, string>> = {
  1: 'Torpe',
  2: 'Aprendiz',
  3: 'Capaz',
  4: 'Hábil',
  5: 'Especialista',
}

export function clampAptitude(value: number): Aptitude {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(5, Math.round(value))) as Aptitude
}

export const isAptitude = (value: unknown): value is Aptitude =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5

export const aptitudeStars = (value: Aptitude): string => '★'.repeat(value) + '☆'.repeat(5 - value)
