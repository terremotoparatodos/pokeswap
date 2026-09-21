// Card facts — Rancho
//
// What the card says about an inhabitant. Honesty rule: "En el Rancho desde"
// is when the ranch first saw the membership; it is never presented as how
// long someone has been subscribed. Membership length only appears when the
// source actually provides it (YouTube Studio's export does, Twitch does not).

import type { RanchResident } from './membership'
import { ZONES } from './zones'

/** dd/mm/yyyy in UTC, so every visitor reads the same date. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}

/** "menos de un mes", "1 mes", "1 año", "2 años y 5 meses". */
export function formatMonths(months: number): string {
  if (months < 1) return 'menos de un mes'
  const years = Math.floor(months / 12)
  const rest = months % 12
  const y = years === 1 ? '1 año' : `${years} años`
  const m = rest === 1 ? '1 mes' : `${rest} meses`
  if (!years) return m
  return rest ? `${y} y ${m}` : y
}

const TWITCH_TIERS: Record<string, string> = { '1000': 'Nivel 1', '2000': 'Nivel 2', '3000': 'Nivel 3' }

export function membershipLabel(resident: Pick<RanchResident, 'platform' | 'tier'>): string {
  if (resident.platform === 'twitch') {
    const tier = resident.tier ? TWITCH_TIERS[resident.tier] : null
    return tier ? `Suscriptor de Twitch · ${tier}` : 'Suscriptor de Twitch'
  }
  return resident.tier ? `Miembro de YouTube · ${resident.tier}` : 'Miembro de YouTube'
}

export interface CardFact {
  label: string
  value: string
}

export function residentFacts(resident: RanchResident): CardFact[] {
  const facts: CardFact[] = [{ label: 'En el Rancho desde', value: formatDate(resident.firstSeenAt) }]
  if (resident.memberSince) facts.push({ label: 'Miembro desde', value: formatDate(resident.memberSince) })
  if (resident.tenureMonths !== null) facts.push({ label: 'Antigüedad', value: formatMonths(resident.tenureMonths) })
  facts.push({ label: 'Vive', value: ZONES[resident.zone].where })
  return facts
}
