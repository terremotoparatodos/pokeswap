import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LobbyHud from './LobbyHud.vue'
import type { HudState } from '../engine/game'
import { PresenceDiagnostics } from '../multiplayer/domain/presenceDiagnostics'

const hud = (areaKind: HudState['areaKind']): HudState => ({
  areaId: areaKind === 'town' ? 'ciudad-corazon' : 'pradera', areaKind,
  place: areaKind === 'town' ? 'Ciudad Corazón' : 'Pradera Brisa', tx: 31, ty: 20,
  phase: 'Día', weather: 'clear', crystals: 0, lens: 'town', toast: null,
  traveling: false, fps: 60, frameMs: 2, frameP95Ms: 3, frameP99Ms: 4, frameMaxMs: 5, longFramePercent: 0,
  remoteActors: 0, remoteUpdatesPerSecond: 0,
  groundComposeMs: 0, groundProjectMs: 0, actorCollectMs: 0,
  actorSortMs: 0, spriteDrawMs: 0, lightingMs: 0,
  loadedChunks: 0, generatedChunks: 0, evictedChunks: 0,
  lastChunkBuildMs: 0, maxChunkBuildMs: 0,
  presence: new PresenceDiagnostics().snapshot(),
})

describe('LobbyHud city recovery', () => {
  it('offers the city button even while already in the city', async () => {
    const wrapper = mount(LobbyHud, { props: { hud: hud('town') } })
    const button = wrapper.find('.wl-home')
    expect(button.exists()).toBe(true)
    expect(button.attributes('title')).toBe('Reubicar en Ciudad Corazón')
    await button.trigger('click')
    expect(wrapper.emitted('home')).toHaveLength(1)
  })
})
