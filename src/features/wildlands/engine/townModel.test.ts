import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../areas/atlas'
import { createProjector, LENSES } from './projection'
import { facing, placeOnFootprint, projectVertices, rasterFrame, rasterize, visibleTriangles, type Texels, type TownModelData } from './townModel'

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
    // Width of the solid part (the ground shadow reaches further).
    const solidWidth = (data: TownModelData) => {
      const xs = data.triangles.filter(t => !data.materials[t[0]].shadow).flatMap(t => t.slice(1, 4).map(i => data.vertices[i][0]))
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(solidWidth(model('pokecenter'))).toBeGreaterThan(78)
    expect(solidWidth(model('pokecenter'))).toBeLessThanOrEqual(84)
    // A bench sits inside one 16 px tile across.
    for (const id of ['bench-1', 'bench-2']) expect(solidWidth(model(id))).toBeLessThanOrEqual(16)
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
    const data = quad([[0, 0, 0], [10, 0, 0], [0, 10, 0]])
    const screen = projectVertices(data, { x: 0, y: 0 }, proj, 0, 0)!
    const ground = proj.project(0, 0)!
    expect(screen[0]).toBeCloseTo(ground.x)
    expect(screen[1]).toBeCloseTo(ground.y)
    expect(screen[7]).toBeCloseTo(ground.y - 10 * ground.scale)
    expect(screen[2]).toBeCloseTo(ground.scale)
  })

  it('opens the Pokémon Center’s left wall when it stands right of the screen centre, and hides it on the left', () => {
    const pc = model('pokecenter')
    const left = Math.min(...pc.vertices.map(v => v[0]))
    const wall = (camX: number) => {
      const front = proj.project(left - camX, pc.front)!
      const back = proj.project(left - camX, pc.bounds.z[0] + 2)!
      return front.x - back.x
    }
    expect(wall(-150)).toBeGreaterThan(0)
    expect(wall(150)).toBeLessThan(0)
  })

  it('skips faces turned away from the camera, like the DS', () => {
    const pc = model('pokecenter')
    const seen = visibleTriangles(pc, { x: 0, y: 0 }, 0, 0, eye)
    expect(seen.length).toBeLessThan(pc.triangles.length)
    // The ground shadow is always drawn.
    const shadow = pc.materials.findIndex(m => m.shadow)
    expect(pc.triangles.filter((t, i) => t[0] === shadow && !seen.includes(i))).toHaveLength(0)
    // A face seen from the front but not from behind.
    expect(facing([0, 0, 0], [1, 0, 0], [0, 1, 0], 0, 0, 1)).toBeGreaterThan(0)
    expect(facing([0, 0, 0], [1, 0, 0], [0, 1, 0], 0, 0, -1)).toBeLessThan(0)
  })

  it('keeps the nearer face whatever the drawing order (depth buffer), and the shadow only where nothing solid is', () => {
    const red = texels([200, 0, 0, 255])
    const blue = texels([0, 0, 200, 255])
    const shade = texels([10, 10, 10, 255])
    const data: TownModelData = {
      id: 't', bounds: { x: [0, 8], y: [0, 8], z: [0, 4] }, center: 0, front: 0,
      // Two squares facing the camera: one at z 0 (far), one at z 4 (near, smaller), and a shadow at the back.
      vertices: [[0, 0, 0], [8, 0, 0], [8, 8, 0], [0, 8, 0], [2, 2, 4], [6, 2, 4], [6, 6, 4], [2, 6, 4], [-4, 0, -8], [12, 0, -8], [12, 0, 8], [-4, 0, 8]],
      materials: [
        { name: 'shade', texture: 's', alpha: 0.5, shadow: true },
        { name: 'far', texture: 'f', alpha: 1, shadow: false },
        { name: 'near', texture: 'n', alpha: 1, shadow: false },
      ],
      triangles: [
        [0, 8, 9, 10, 0, 0, 0, 0, 0, 0], [0, 8, 10, 11, 0, 0, 0, 0, 0, 0],
        [2, 4, 5, 6, 0, 0, 0, 0, 0, 0], [2, 4, 6, 7, 0, 0, 0, 0, 0, 0],
        [1, 0, 1, 2, 0, 0, 0, 0, 0, 0], [1, 0, 2, 3, 0, 0, 0, 0, 0, 0],
      ],
    }
    const m = { data, textures: [shade, red, blue] }
    const screen = projectVertices(data, { x: 0, y: 0 }, proj, 4, 0)!
    const frame = rasterFrame(screen, 1)
    const px = rasterize(m, screen, [0, 1, 2, 3, 4, 5], frame)
    const at = (wx: number, h: number, wz: number) => {
      const p = proj.project(wx - 4, wz)!
      const o = (Math.floor(p.y - h * p.scale - frame.y) * frame.width + Math.floor(p.x - frame.x)) * 4
      return [px[o], px[o + 1], px[o + 2], px[o + 3]]
    }
    expect(at(4, 4, 4)).toEqual([0, 0, 200, 255]) // near square wins though drawn first
    expect(at(1, 7, 0)).toEqual([200, 0, 0, 255]) // far square where the near one is not
    expect(at(-3, 0, 6)[3]).toBe(128) // shadow alone: translucent
  })
})

function quad(vertices: [number, number, number][]): TownModelData {
  return {
    id: 't', bounds: { x: [0, 0], y: [0, 10], z: [0, 0] }, center: 0, front: 0, vertices,
    materials: [{ name: 'm', texture: 'm.png', alpha: 1, shadow: false }],
    triangles: [[0, 0, 1, 2, 0, 0, 10, 0, 0, 10]],
  }
}

function texels(rgba: number[]): Texels {
  return { width: 1, height: 1, data: new Uint8ClampedArray(rgba) }
}
