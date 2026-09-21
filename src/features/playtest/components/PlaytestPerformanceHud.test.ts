import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaytestPerformanceHud from './PlaytestPerformanceHud.vue'

describe('PlaytestPerformanceHud', () => {
  it('shows client fps, frame cost and an honest unavailable network sample', () => {
    const wrapper = mount(PlaytestPerformanceHud, { props: {
      fps: 47, frameMs: 18.25, frameP95Ms: 31.2, frameP99Ms: 42.7, frameMaxMs: 55.1, longFramePercent: 4,
      remoteActors: 25, remoteUpdatesPerSecond: 83.4,
      groundComposeMs: 2.1, groundProjectMs: 3.2, actorCollectMs: 0.8,
      actorSortMs: 0.2, spriteDrawMs: 1.4, lightingMs: 0.6,
      loadedChunks: 9, generatedChunks: 12, evictedChunks: 3,
      lastChunkBuildMs: 14.2, maxChunkBuildMs: 28.6,
    } })
    expect(wrapper.text()).toContain('47 FPS')
    expect(wrapper.text()).toContain('18.3 ms promedio')
    expect(wrapper.text()).toContain('31.2 ms p95')
    expect(wrapper.text()).toContain('42.7 ms p99')
    expect(wrapper.text()).toContain('55.1 ms máx')
    expect(wrapper.text()).toContain('4% >33 ms')
    expect(wrapper.text()).toContain('25 remotos')
    expect(wrapper.text()).toContain('83.4 upd/s')
    expect(wrapper.text()).toContain('2.1 ms suelo')
    expect(wrapper.text()).toContain('3.2 ms proyección')
    expect(wrapper.text()).toContain('0.8 ms collect')
    expect(wrapper.text()).toContain('0.2 ms sort')
    expect(wrapper.text()).toContain('1.4 ms sprites')
    expect(wrapper.text()).toContain('0.6 ms luz')
    expect(wrapper.text()).toContain('9 chunks vivos')
    expect(wrapper.text()).toContain('12/3 gen/evict')
    expect(wrapper.text()).toContain('14.2/28.6 ms chunk últ/máx')
    expect(wrapper.text()).toContain('… HTTP')
    wrapper.unmount()
  })
})
