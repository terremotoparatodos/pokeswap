import { describe, expect, it } from 'vitest'
import { ZONE_IDS, type ZoneId } from '../domain/zones'
import { mockMemberships } from './mockMembers'
import { createMockSnapshot } from './mockSnapshot'
import { readRanchParams, urlWithUser } from './urlParams'

const roomy = Object.fromEntries(ZONE_IDS.map(z => [z, 10_000])) as Record<ZoneId, number>
const now = new Date('2026-09-21T12:00:00Z')

describe('mock memberships', () => {
  it('is prefix-stable: ?mock=2000 starts with the default hundred', () => {
    expect(mockMemberships(2000).slice(0, 100)).toEqual(mockMemberships(100))
  })

  it('starts with the two examples and mixes both platforms', () => {
    const members = mockMemberships(100)
    expect(members[0]).toMatchObject({ platform: 'twitch', displayName: 'Terremotito123' })
    expect(members[1]).toMatchObject({ platform: 'youtube', displayName: 'JuanPerez' })
    const twitch = members.filter(m => m.platform === 'twitch').length
    expect(twitch).toBeGreaterThan(45)
    expect(twitch).toBeLessThan(75)
  })

  it('has unique names and platform ids', () => {
    const members = mockMemberships(2000)
    expect(new Set(members.map(m => m.displayName.toLowerCase())).size).toBe(2000)
    expect(new Set(members.map(m => `${m.platform}:${m.platformUserId}`)).size).toBe(2000)
  })

  it('keeps hostile names out of the default hundred', () => {
    const names = mockMemberships(100).map(m => m.displayName)
    expect(names.some(n => /[<>{}‮]/.test(n))).toBe(false)
    expect(mockMemberships(200).some(m => m.displayName.includes('<img'))).toBe(true)
  })

  it('gives Twitch no tenure and YouTube a tenure in months', () => {
    for (const m of mockMemberships(300)) {
      if (m.platform === 'twitch') expect(m.tenureMonths).toBeNull()
      else expect(m.tenureMonths).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('mock snapshot', () => {
  it('assigns the examples their Pokémon and everyone a species from the pool', () => {
    const snapshot = createMockSnapshot(100, roomy, now)
    expect(snapshot.residents[0]).toMatchObject({ displayName: 'Terremotito123', speciesId: 258 })
    expect(snapshot.residents[1]).toMatchObject({ displayName: 'JuanPerez', speciesId: 197 })
  })

  it('is stable across reloads and across sizes', () => {
    const a = createMockSnapshot(100, roomy, now)
    const b = createMockSnapshot(2000, roomy, now)
    expect(b.residents.slice(0, 100)).toEqual(a.residents)
  })

  it('orders arrivals oldest first, within the last two years', () => {
    const residents = createMockSnapshot(500, roomy, now).residents
    for (let i = 1; i < residents.length; i++) {
      expect(Date.parse(residents[i].firstSeenAt)).toBeGreaterThanOrEqual(Date.parse(residents[i - 1].firstSeenAt) - 86_400_000)
    }
    expect(Date.parse(residents[0].firstSeenAt)).toBeGreaterThan(now.getTime() - 731 * 86_400_000)
  })

  it('drops members whose name is empty once cleaned', () => {
    const residents = createMockSnapshot(200, roomy, now).residents
    expect(residents.every(r => r.displayName.trim().length > 0)).toBe(true)
    expect(residents.some(r => r.displayName.includes('‮'))).toBe(false)
  })
})

describe('url params', () => {
  it('defaults to 100 and clamps', () => {
    expect(readRanchParams('')).toEqual({ mock: 100, user: null, debug: false })
    expect(readRanchParams('?mock=2000&u=JuanPerez&debug=1')).toEqual({ mock: 2000, user: 'JuanPerez', debug: true })
    expect(readRanchParams('?mock=999999').mock).toBe(5000)
    expect(readRanchParams('?mock=-3').mock).toBe(0)
    expect(readRanchParams('?mock=abc').mock).toBe(100)
  })

  it('sets and clears the shared user without touching the rest', () => {
    expect(urlWithUser('https://x.lol/rancho/?mock=2000', 'Juan Pérez')).toBe('/rancho/?mock=2000&u=Juan+P%C3%A9rez')
    expect(urlWithUser('https://x.lol/rancho/?u=a&mock=5', null)).toBe('/rancho/?mock=5')
  })
})
