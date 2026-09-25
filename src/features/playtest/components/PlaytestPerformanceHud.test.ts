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

  it('shows presence diagnostics when the world provides them', () => {
    const wrapper = mount(PlaytestPerformanceHud, { props: {
      fps: 60, frameMs: 2, frameP95Ms: 3, frameP99Ms: 4, frameMaxMs: 5, longFramePercent: 0,
      remoteActors: 0, remoteUpdatesPerSecond: 0, groundComposeMs: 0, groundProjectMs: 0, actorCollectMs: 0,
      actorSortMs: 0, spriteDrawMs: 0, lightingMs: 0, loadedChunks: 0, generatedChunks: 0, evictedChunks: 0,
      lastChunkBuildMs: 0, maxChunkBuildMs: 0,
      presence: {
        sent: 12, lastSent: 12, lastAcked: 11, rttMs: { p50: 95, p95: 140, p99: 180, max: 210, samples: 11 },
        reconciliations: 1, solidRecoveries: 0, placements: 2, staleAcksIgnored: 1,
        rejections: { rate: 0, replay: 0, other: 0 }, disconnects: 0,
      },
    } })
    expect(wrapper.text()).toContain('95/140/180/210 ms RTT mov')
    expect(wrapper.text()).toContain('12/11 seq env/conf')
    expect(wrapper.text()).toContain('0 punto seguro')
    expect(wrapper.text()).toContain('0/0/0 rech ritmo/replay/otro')
  })
})

describe('PlaytestPerformanceHud on a phone', () => {
  const props = {
    fps: 60, frameMs: 2, frameP95Ms: 2.9, frameP99Ms: 4, frameMaxMs: 5, longFramePercent: 0,
    remoteActors: 11, remoteUpdatesPerSecond: 0, groundComposeMs: 0, groundProjectMs: 0, actorCollectMs: 0,
    actorSortMs: 0, spriteDrawMs: 0, lightingMs: 0, loadedChunks: 0, generatedChunks: 0, evictedChunks: 0,
    lastChunkBuildMs: 0, maxChunkBuildMs: 0,
  }
  const phone = (matches: boolean) => {
    localStorage.clear()
    window.matchMedia = ((query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  }

  it('starts as one line and opens every metric when tapped, then folds back', async () => {
    phone(true)
    const wrapper = mount(PlaytestPerformanceHud, { props })
    expect(wrapper.text()).toContain('PERF · 60 fps · 2.9 ms · 11 rem')
    expect(wrapper.text()).not.toContain('ms proyección')
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('ms proyección')
    expect(wrapper.text()).toContain('11 remotos')
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).not.toContain('ms proyección')
    wrapper.unmount()
  })

  it('remembers the choice, and a desktop starts open', async () => {
    phone(true)
    const first = mount(PlaytestPerformanceHud, { props })
    await first.get('button').trigger('click')
    first.unmount()
    const again = mount(PlaytestPerformanceHud, { props })
    expect(again.text()).toContain('ms proyección')
    again.unmount()

    phone(false)
    const desktop = mount(PlaytestPerformanceHud, { props })
    expect(desktop.text()).toContain('ms proyección')
    desktop.unmount()
  })
})
