import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../areas/atlas'
import { createProjector, LENSES } from './projection'
import { placeOnFootprint, projectModel, textureTransform, type TownModelData } from './townModel'

const MODELS = import.meta.glob<TownModelData>('../../../../public/assets/town/models/*.json', { eager: true, import: 'default' })
const TEXTURES = import.meta.glob('../../../../public/assets/town/models/*.png', { eager: true, query: '?url', import: 'default' })
const model = (id: string) => Object.entries(MODELS).find(([path]) => path.endsWith(`/${id}.json`))![1]

const view = { width: 1000, height: 700, focusY: 434 }
const proj = createProjector(LENSES.handheld, view)
const eye = { depth: LENSES.handheld.distance, height: LENSES.handheld.squash * LENSES.handheld.distance }

describe('converted town models', () => {
  it('are whole: every triangle points at real vertices, materials and textures', () => {
    for (const [path, data] of Object.entries(MODELS)) {
      for (const t of data.triangles) {
        expect(t, path).toHaveLength(10)
        expect(data.materials[t[0]], path).toBeDefined()
        for (const i of t.slice(1, 4)) expect(data.vertices[i], path).toBeDefined()
      }
      for (const m of data.materials) expect(Object.keys(TEXTURES).some(p => p.endsWith(`/${m.texture}`)), m.texture).toBe(true)
      expect(data.materials.filter(m => m.shadow)).toHaveLength(1)
    }
  })

  it('keep the handheld scale: the Pokémon Center is as wide as its 5-tile footprint, benches one tile', () => {
    const pc = model('pokecenter')
    expect(pc.bounds.x[1] - pc.bounds.x[0]).toBeGreaterThan(78)
    expect(pc.bounds.x[1] - pc.bounds.x[0]).toBeLessThan(84)
    for (const id of ['bench-1', 'bench-2']) expect(model(id).bounds.x[1] - model(id).bounds.x[0]).toBeCloseTo(16, 0)
  })

  it('are drawn by Ciudad Corazón: the Pokémon Center and both benches', () => {
    expect(HEARTHOME.buildings.find(b => b.id === 'pokecenter')?.image?.model).toBe('/assets/town/models/pokecenter.json')
    expect(HEARTHOME.art?.models).toEqual({ bench: '/assets/town/models/bench-1.json', benchLeft: '/assets/town/models/bench-2.json' })
  })
})

describe('drawing a model', () => {
  it('stands it centred on its footprint with its front on the footprint’s front edge', () => {
    expect(placeOnFootprint({ center: 1, front: 26 }, 280, 320)).toEqual({ x: 279, y: 294 })
  })

  it('projects with the ground’s own perspective: taller points rise by their height × scale', () => {
    const data: TownModelData = {
      id: 't', bounds: { x: [0, 0], y: [0, 10], z: [0, 0] }, center: 0, front: 0,
      vertices: [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
      materials: [{ name: 'm', texture: 'm.png', alpha: 1, shadow: false }],
      triangles: [[0, 0, 1, 2, 0, 0, 10, 0, 0, 10]],
    }
    const [t] = projectModel(data, { x: 0, y: 0 }, proj, 0, 0, eye)!
    const ground = proj.project(0, 0)!
    expect(t.points[0]).toBeCloseTo(ground.x)
    expect(t.points[1]).toBeCloseTo(ground.y)
    expect(t.points[5]).toBeCloseTo(ground.y - 10 * ground.scale)
  })

  it('opens the Pokémon Center’s left wall when it stands right of the screen centre, and hides it on the left', () => {
    const pc = model('pokecenter')
    const left = Math.min(...pc.vertices.map(v => v[0]))
    // The wall's front and back feet on screen: the back lands nearer the centre.
    const wall = (camX: number) => {
      const front = proj.project(left - camX, pc.front)!
      const back = proj.project(left - camX, pc.bounds.z[0] + 2)!
      return front.x - back.x
    }
    expect(wall(-150)).toBeGreaterThan(0) // building right of centre: back is further left → wall visible
    expect(wall(150)).toBeLessThan(0) // building left of centre: the wall turns away
  })

  it('sorts the ground shadow first, then far to near', () => {
    const tris = projectModel(model('bench-1'), { x: 0, y: 0 }, proj, 0, 0, eye)!
    const shadow = model('bench-1').materials.findIndex(m => m.shadow)
    const firstSolid = tris.findIndex(t => t.material !== shadow)
    expect(tris.slice(0, firstSolid).every(t => t.material === shadow)).toBe(true)
    for (let i = firstSolid + 1; i < tris.length; i++) expect(tris[i].distance).toBeLessThanOrEqual(tris[i - 1].distance)
  })

  it('maps texture pixels onto the screen triangle exactly at its corners', () => {
    const points = [10, 20, 50, 25, 15, 70] as const
    const uv = [0, 0, 32, 0, 0, 32] as const
    const [a, b, c, d, e, f] = textureTransform(points, uv)!
    for (let i = 0; i < 3; i++) {
      const [u, v] = [uv[i * 2], uv[i * 2 + 1]]
      expect(a * u + c * v + e).toBeCloseTo(points[i * 2])
      expect(b * u + d * v + f).toBeCloseTo(points[i * 2 + 1])
    }
    expect(textureTransform(points, [0, 0, 1, 1, 2, 2])).toBeNull()
  })
})
