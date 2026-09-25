import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { RESOURCE_BY_ID } from '../domain/resources'
import { SKILL_IDS, type SkillId } from '../domain/skills'
import { totalXpForLevel } from '../domain/xpCurve'
import { createManualClock, createMemorySkillsStore } from '../service/memoryAdapters'
import { createSkillsService } from '../service/skillsService'
import SkillsBag from './SkillsBag.vue'
import SkillsPanel from './SkillsPanel.vue'
import WorkCard from './WorkCard.vue'

// jsdom has no 2D canvas; icons fall back to a letter.
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })

const xpAt = (levels: Partial<Record<SkillId, number>> = {}) =>
  Object.fromEntries(SKILL_IDS.map(id => [id, totalXpForLevel(levels[id] ?? 1)])) as Record<SkillId, number>

const CREW = [
  { instanceId: 'a', speciesId: 129 }, // Magikarp
  { instanceId: 'b', speciesId: 123 }, // Scyther
  { instanceId: 'c', speciesId: 185 }, // Sudowoodo
]

describe('SkillsPanel', () => {
  it('shows exactly three skills — no Pesca, no Alquimia', async () => {
    const wrapper = mount(SkillsPanel, { props: { xp: xpAt(), workers: CREW } })
    await wrapper.get('.sk-tab').trigger('click')
    const names = wrapper.findAll('.sk-name').map(node => node.text())
    expect(names).toEqual(['Talar', 'Minería', 'Agricultura'])
    expect(wrapper.text()).not.toMatch(/Pesca|Alquimia|energía|herramienta/i)
    wrapper.unmount()
  })

  it('answers "where am I and what is next" on every row', async () => {
    const wrapper = mount(SkillsPanel, { props: { xp: xpAt({ mining: 9 }), workers: CREW } })
    await wrapper.get('.sk-tab').trigger('click')
    const mining = wrapper.get('.sk-row--mining')
    expect(mining.get('.sk-level').text()).toBe('9')
    expect(mining.get('.sk-next').text()).toContain('Nv 10 · Veta de carbón')
    expect(wrapper.get('.sk-tab').text()).toContain(String(1 + 9 + 1))
    wrapper.unmount()
  })

  it('opens a skill roadmap with the best worker of the party', async () => {
    const wrapper = mount(SkillsPanel, { props: { xp: xpAt({ woodcutting: 12 }), workers: CREW } })
    await wrapper.get('.sk-tab').trigger('click')
    await wrapper.get('.sk-row--woodcutting .sk-summary').trigger('click')
    expect(wrapper.get('.sk-best').text()).toContain('Scyther')
    expect(wrapper.find('.sk-step--next').text()).toContain('20')
    expect(wrapper.findAll('.sk-step--unlocked').map(step => step.text()).join()).toContain('Pino')
    wrapper.unmount()
  })

  it('still toggles from the same button (MOBILE-1) and reports each change', async () => {
    const wrapper = mount(SkillsPanel, { props: { xp: xpAt(), workers: CREW } })
    await wrapper.get('.sk-tab').trigger('click')
    await wrapper.get('.sk-tab').trigger('click')
    await wrapper.get('.sk-tab').trigger('click')
    await wrapper.get('.sk-x').trigger('click')
    expect(wrapper.find('.sk-panel').exists()).toBe(false)
    expect(wrapper.emitted('open')?.map(([open]) => open)).toEqual([true, false, true, false])
    wrapper.unmount()
  })
})

describe('WorkCard', () => {
  const base = {
    resource: RESOURCE_BY_ID.get('pine_tree')!,
    state: { status: 'available' as const, remainingCharges: 4, respawnInSeconds: 0 },
    phase: 'idle' as const, run: null, result: null, refusal: null, workers: CREW, lastWorker: null,
  }

  it('turns a locked tree into a goal instead of a dead end', () => {
    const wrapper = mount(WorkCard, { props: { ...base, xp: xpAt({ woodcutting: 7 }), state: { ...base.state, status: 'locked_level' as const } } })
    expect(wrapper.get('.wc-req').text()).toBe('Requiere Talar 12')
    expect(wrapper.get('.wc-tip').text()).toBe('Tenés Talar 7 · seguí con Árbol común')
    expect(wrapper.find('.wc-go').exists()).toBe(false)
  })

  it('lists the party best-first with aptitude and time, and preselects the best', () => {
    const wrapper = mount(WorkCard, { props: { ...base, xp: xpAt({ woodcutting: 12 }) } })
    const names = wrapper.findAll('.wc-worker-name').map(node => node.text())
    expect(names[0]).toBe('Scyther')
    expect(wrapper.get('.wc-worker--on').text()).toContain('Scyther')
    expect(wrapper.get('.wc-go').text()).toBe('Talar con Scyther')
    expect(wrapper.text()).not.toMatch(/hacha|herramienta|energía/i)
  })

  it('greys out a Pokémon below the rung\'s minimum aptitude, never the whole node', () => {
    const wrapper = mount(WorkCard, { props: { ...base, resource: RESOURCE_BY_ID.get('boreal_tree')!, xp: xpAt({ woodcutting: 40 }) } })
    const sudowoodo = wrapper.findAll('.wc-worker').find(node => node.text().includes('Sudowoodo'))!
    expect(sudowoodo.attributes('disabled')).toBeDefined()
    expect(sudowoodo.text()).toContain('Necesita ★★')
    expect(wrapper.get('.wc-go').attributes('disabled')).toBeUndefined()
  })

  it('emits the chosen PokemonInstance, not a separate work Pokémon', async () => {
    const wrapper = mount(WorkCard, { props: { ...base, xp: xpAt({ woodcutting: 12 }) } })
    await wrapper.findAll('.wc-worker').find(node => node.text().includes('Magikarp'))!.trigger('click')
    await wrapper.get('.wc-go').trigger('click')
    expect(wrapper.emitted('work')?.[0]).toEqual([{ instanceId: 'a', speciesId: 129 }, 'Magikarp'])
  })

  it('shows +XP, +item and the level-up with what it unlocked', async () => {
    // The SKILLS service as the server runs it; the card shows what it settled.
    const clock = createManualClock(0)
    const store = createMemorySkillsStore()
    store.setXp('p', 'mining', totalXpForLevel(10) - 1)
    const service = createSkillsService({ progress: store.progress, ledger: store.ledger, clock, random: () => 0.5 })
    const begin = service.authorizeWorkAttempt({ actionId: 'a-1', playerId: 'p', worker: { instanceId: 'g', speciesId: 74 }, target: { kind: 'gather', resourceId: 'stone_outcrop' } })
    if (!begin.allowed) throw new Error(begin.message)
    clock.advance(begin.durationMs)
    const result = service.settleWork('a-1', { outcome: 'completed' })
    const resource = RESOURCE_BY_ID.get('stone_outcrop')!

    const wrapper = mount(WorkCard, {
      props: { ...base, resource, phase: 'result' as const, result, xp: store.progress.xpOf('p'), workers: [{ instanceId: 'g', speciesId: 74 }] },
    })
    expect(wrapper.get('.wc-levelup').text()).toBe('Minería 9 → 10')
    expect(wrapper.findAll('.wc-unlock').map(node => node.text())).toEqual(['Nuevo: Veta de carbón', 'Ritmo 1: todo trabajo 4 % más rápido'])
    expect(wrapper.get('.wc-gains').text()).toContain('+10 XP Minería')
    expect(wrapper.get('.wc-gains').text()).toContain('Piedra')
  })
})

describe('SkillsBag', () => {
  it('says what each material is for', () => {
    const wrapper = mount(SkillsBag, { props: { inventory: { coal: 3, common_log: 2 } } })
    expect(wrapper.findAll('.bag-name').map(node => node.text())).toEqual(['Tronco común', 'Carbón'])
    expect(wrapper.text()).toContain('Combustible')
  })
})
