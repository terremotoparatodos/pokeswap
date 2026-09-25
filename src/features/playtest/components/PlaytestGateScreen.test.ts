// What a player sees when the playtest is not open to them.
//
// The gate is the one thing that has to work on the night, so its three states
// are mounted rather than trusted: waiting, closed, and asking for the code.

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaytestGateScreen from './PlaytestGateScreen.vue'
import { DEFAULT_CLOSED_MESSAGE } from '../domain/playtestGate'

describe('the gate screen', () => {
  it('says it is still checking before the remote gate answers, and offers to re-check', async () => {
    const wrapper = mount(PlaytestGateScreen, { props: { access: { status: 'checking' } } })
    expect(wrapper.text()).toContain('Un segundo')
    expect(wrapper.find('input').exists()).toBe(false)
    // No network at all keeps a tab here (never open): the player can retry.
    await wrapper.find('.pt-gate-btn').trigger('click')
    expect(wrapper.emitted('recheck')).toHaveLength(1)
  })

  it('shows the operator message when closed, and offers to re-check', async () => {
    const wrapper = mount(PlaytestGateScreen, {
      props: { access: { status: 'closed', message: 'Volvemos el sábado' } },
    })
    expect(wrapper.text()).toContain('Playtest cerrado')
    expect(wrapper.text()).toContain('Volvemos el sábado')
    await wrapper.find('.pt-gate-btn').trigger('click')
    expect(wrapper.emitted('recheck')).toHaveLength(1)
  })

  it('falls back to the default sentence when the operator left none', () => {
    const wrapper = mount(PlaytestGateScreen, {
      props: { access: { status: 'closed', message: DEFAULT_CLOSED_MESSAGE } },
    })
    expect(wrapper.text()).toContain('Gracias por jugar')
  })

  it('asks for the code, and will not submit an empty one', async () => {
    const wrapper = mount(PlaytestGateScreen, { props: { access: { status: 'locked', wrongCode: false } } })
    expect(wrapper.find('.pt-gate-btn').attributes('disabled')).toBeDefined()

    await wrapper.find('input').setValue('  pikachu ')
    expect(wrapper.find('.pt-gate-btn').attributes('disabled')).toBeUndefined()
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([['pikachu']])
  })

  it('tells the player when the code was wrong instead of failing silently', () => {
    const wrapper = mount(PlaytestGateScreen, { props: { access: { status: 'locked', wrongCode: true } } })
    expect(wrapper.find('.pt-gate-error').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toMatch(/código no es/i)
  })

  it('always names the build that refused them', () => {
    for (const access of [
      { status: 'checking' as const },
      { status: 'closed' as const, message: 'x' },
      { status: 'locked' as const, wrongCode: false },
    ]) {
      const wrapper = mount(PlaytestGateScreen, { props: { access } })
      expect(wrapper.find('.pt-gate-kicker').text()).toContain('Community Playtest 0.2')
    }
  })
})
