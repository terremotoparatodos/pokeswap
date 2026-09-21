import { describe, expect, it } from 'vitest'
import type { RanchResident } from './membership'
import { formatDate, formatMonths, membershipLabel, residentFacts } from './tenure'

const base: RanchResident = {
  id: 'r0', platform: 'twitch', displayName: 'Terremotito123', speciesId: 258, shiny: false, zone: 'lago', slot: 0,
  firstSeenAt: '2024-04-12T15:00:00.000Z', memberSince: null, tenureMonths: null, tier: '1000',
}

describe('formatMonths', () => {
  it('reads like a person would say it', () => {
    expect(formatMonths(0)).toBe('menos de un mes')
    expect(formatMonths(1)).toBe('1 mes')
    expect(formatMonths(5)).toBe('5 meses')
    expect(formatMonths(12)).toBe('1 año')
    expect(formatMonths(13)).toBe('1 año y 1 mes')
    expect(formatMonths(29)).toBe('2 años y 5 meses')
    expect(formatMonths(36)).toBe('3 años')
  })
})

describe('formatDate', () => {
  it('uses dd/mm/yyyy in UTC', () => {
    expect(formatDate('2024-04-12T23:30:00.000Z')).toBe('12/04/2024')
    expect(formatDate('2025-01-01T00:00:00.000Z')).toBe('01/01/2025')
  })
})

describe('card facts', () => {
  it('never presents Twitch first-seen as subscription tenure', () => {
    const facts = residentFacts(base)
    expect(facts[0]).toEqual({ label: 'En el Rancho desde', value: '12/04/2024' })
    expect(facts.map(f => f.label)).not.toContain('Antigüedad')
    expect(facts.map(f => f.label)).not.toContain('Miembro desde')
    expect(facts[facts.length - 1]).toEqual({ label: 'Vive', value: 'a orillas del lago' })
  })

  it('shows membership length only when the source provides it', () => {
    const facts = residentFacts({ ...base, platform: 'youtube', tenureMonths: 29, tier: 'Líder de Gimnasio' })
    expect(facts).toContainEqual({ label: 'Antigüedad', value: '2 años y 5 meses' })
  })

  it('labels the membership', () => {
    expect(membershipLabel(base)).toBe('Suscriptor de Twitch · Nivel 1')
    expect(membershipLabel({ platform: 'twitch', tier: null })).toBe('Suscriptor de Twitch')
    expect(membershipLabel({ platform: 'youtube', tier: 'Campeón' })).toBe('Miembro de YouTube · Campeón')
  })
})
