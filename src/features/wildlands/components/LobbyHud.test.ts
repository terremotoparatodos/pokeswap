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

describe('LobbyHud (CAVES-4: no "Ciudad" teleport)', () => {
  it.each(['town', 'wild'] as const)('has no button and emits nothing in %s', areaKind => {
    const wrapper = mount(LobbyHud, { props: { hud: hud(areaKind) } })
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.find('.wl-home').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Ciudad$|Volver a Ciudad|Reubicar/)
    expect(Object.keys(wrapper.emitted())).not.toContain('home')
  })
})
