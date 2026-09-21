// Mock memberships — Rancho (RANCH-1)
//
// Stand-in for the future sources (Twitch sync, YouTube Studio CSV): it emits
// the same NormalizedMembership shape. Member i is derived from i alone, so the
// list is prefix-stable: ?mock=2000 starts with exactly the 100 of the default.
// Hostile names only appear past the first 100, for the stress runs.

import type { NormalizedMembership } from '../domain/membership'
import { hashString, seededRandom } from '../domain/seededRandom'

/** The two examples from the brief, always first. */
export const PRESET_MEMBERS: readonly NormalizedMembership[] = [
  { platform: 'twitch', platformUserId: '41000001', displayName: 'Terremotito123', memberSince: null, tenureMonths: null, tier: '1000' },
  { platform: 'youtube', platformUserId: 'UCjuanPerez0000000000001', displayName: 'JuanPerez', memberSince: null, tenureMonths: 29, tier: 'Líder de Gimnasio' },
]

const WORDS = [
  'sombra', 'luna', 'sol', 'rayo', 'trueno', 'chispa', 'nube', 'mate', 'tango', 'pixel', 'lobo', 'gato',
  'zorro', 'puma', 'condor', 'pibe', 'capo', 'bicho', 'pollo', 'mango', 'fideo', 'dulce', 'nieve', 'fuego',
  'hoja', 'roca', 'ola', 'brisa', 'cometa', 'astro', 'kiwi', 'tito', 'nacho', 'lucho', 'tomi', 'mili',
  'cande', 'agus', 'juli', 'sofi', 'valen', 'benja', 'santi', 'fran', 'maxi', 'guille', 'pato', 'queso',
]
const POKE_WORDS = [
  'mudkip', 'eevee', 'pika', 'charmander', 'snorlax', 'gengar', 'lucario', 'piplup', 'togepi', 'umbreon',
  'vulpix', 'psyduck', 'bidoof', 'squirtle', 'totodile', 'shinx', 'riolu', 'buneary', 'pachirisu', 'turtwig',
]
const TITLES = ['Entrenador', 'Maestro', 'Criador', 'Ranger', 'Campeon', 'Lider', 'Capitan']
const FIRST = [
  'Juan', 'María', 'Sofía', 'Martín', 'Lucía', 'Mateo', 'Valentina', 'Santiago', 'Camila', 'Benjamín', 'Julieta',
  'Tomás', 'Agustina', 'Joaquín', 'Florencia', 'Nicolás', 'Catalina', 'Facundo', 'Micaela', 'Lautaro', 'Carla',
  'Diego', 'Paula', 'Andrés', 'Rocío', 'Gonzalo', 'Ana', 'Pablo', 'Iván', 'Luz',
]
const LAST = [
  'Pérez', 'González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'García', 'Sánchez', 'Romero', 'Sosa',
  'Torres', 'Álvarez', 'Ruiz', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Suárez',
  'Aguirre', 'Giménez', 'Gutiérrez', 'Molina', 'Castro', 'Ortiz',
]
const EMOJI = ['✨', '🌸', '🔥', '⚡', '🌙', '🎮', '🍀']
const YT_LEVELS: readonly [string, number][] = [['Entrenador', 0.7], ['Líder de Gimnasio', 0.22], ['Campeón', 0.08]]

/** Realistic oddities inside the default hundred. */
const SPECIAL_NAMES: Record<number, string> = {
  12: '🌸 Florcita',
  37: 'ElEntrenadorMasLargoDeTodoElRancho',
  64: 'Ñandú_Veloz',
}
/** Hostile or broken names: only in stress runs. */
const HOSTILE_NAMES: Record<number, string> = {
  150: '<img src=x onerror=alert(1)>',
  151: '‮gnp.exe',
  152: 'Z̸a̵l̶g̷o̴ ̵t̶e̷x̸t̵',
  153: 'x'.repeat(80),
  154: '   ',
  155: '{{ constructor.constructor("alert(1)")() }}',
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length)]

function twitchName(rand: () => number): string {
  const style = rand()
  if (style < 0.25) return cap(pick(WORDS, rand())) + cap(pick(WORDS, rand()))
  if (style < 0.45) return pick(WORDS, rand()) + '_' + Math.floor(rand() * 2010 + 10)
  if (style < 0.6) return cap(pick(POKE_WORDS, rand())) + pick(['Fan', 'Lover', 'Master', 'Kid', 'TV'], rand())
  if (style < 0.72) return 'El' + cap(pick(WORDS, rand())) + 'De' + cap(pick(POKE_WORDS, rand()))
  if (style < 0.82) return pick(TITLES, rand()) + cap(pick(WORDS, rand())) + Math.floor(rand() * 99)
  if (style < 0.9) return 'xX_' + cap(pick(WORDS, rand())) + '_Xx'
  return cap(pick(WORDS, rand())) + 'ito' + Math.floor(rand() * 999)
}

function youtubeName(rand: () => number): string {
  const style = rand()
  const first = pick(FIRST, rand())
  if (style < 0.45) return `${first} ${pick(LAST, rand())}`
  if (style < 0.6) return `${first} ${pick(['Gamer', 'Plays', 'Games', 'TV', 'Poké'], rand())}`
  if (style < 0.72) return `${first} ${pick(EMOJI, rand())}`
  if (style < 0.85) return `${cap(pick(POKE_WORDS, rand()))} ${pick(['de', 'con'], rand())} ${first}`
  return `${first}${pick(LAST, rand()).slice(0, 3)}${Math.floor(rand() * 99)}`
}

function youtubeId(i: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const rand = seededRandom(hashString(`yt-id:${i}`))
  let id = 'UC'
  for (let k = 0; k < 22; k++) id += alphabet[Math.floor(rand() * alphabet.length)]
  return id
}

function generated(i: number): NormalizedMembership {
  const rand = seededRandom(hashString(`rancho-mock:${i}`))
  const twitch = rand() < 0.6
  const name = HOSTILE_NAMES[i] ?? SPECIAL_NAMES[i] ?? (twitch ? twitchName(rand) : youtubeName(rand))
  if (twitch) {
    const t = rand()
    return {
      platform: 'twitch', platformUserId: String(41000000 + i * 37), displayName: name,
      memberSince: null, tenureMonths: null, tier: t < 0.82 ? '1000' : t < 0.94 ? '2000' : '3000',
    }
  }
  let u = rand()
  const level = YT_LEVELS.find(([, weight]) => (u -= weight) < 0)?.[0] ?? YT_LEVELS[0][0]
  return {
    platform: 'youtube', platformUserId: youtubeId(i), displayName: name,
    memberSince: null, tenureMonths: 1 + Math.floor(rand() ** 1.6 * 40), tier: level,
  }
}

/** The first `count` mock members, in arrival order, with unique display names. */
export function mockMemberships(count: number): NormalizedMembership[] {
  const out: NormalizedMembership[] = []
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    const member = i < PRESET_MEMBERS.length ? { ...PRESET_MEMBERS[i] } : generated(i)
    let name = member.displayName
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${member.displayName}${n}`
    seen.add(name.toLowerCase())
    out.push({ ...member, displayName: name })
  }
  return out
}
