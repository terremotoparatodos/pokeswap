import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../areas/atlas'
import { TownArea, type TownDef, type TownProp } from '../areas/townArea'
import { fencePiece, townPropFeet, townPropTiles, type FencePiece } from './townProps'

/** A fence map from a picture: `-` horizontal, `|` vertical. */
function fences(rows: string[]) {
  const at = (tx: number, ty: number) => {
    const c = rows[ty]?.[tx]
    return c === '-' ? 'h' : c === '|' ? 'v' : null
  }
  const piece = (tx: number, ty: number) => fencePiece(at, tx, ty)
  return { at, piece }
}

describe('fence autotiling', () => {
  it('turns an enclosure into straight runs and four real corners', () => {
    const { piece } = fences([
      '-----',
      '|...|',
      '|...|',
      '-----',
    ])
    expect([piece(0, 0), piece(4, 0), piece(0, 3), piece(4, 3)]).toEqual(['nw', 'ne', 'sw', 'se'])
    expect(piece(2, 0)).toBe('h')
    expect(piece(2, 3)).toBe('h')
    // The left side stands under the left picket, the right side under the right one.
    expect([piece(0, 1), piece(0, 2)]).toEqual(['v', 'v'])
    expect([piece(4, 1), piece(4, 2)]).toEqual(['vRight', 'vRight'])
  })

  it('finds the corner whether it was laid as a horizontal or a vertical tile', () => {
    const asVertical = fences([
      '|--',
      '|..',
    ])
    expect(asVertical.piece(0, 0)).toBe('nw')
    const endingRight = fences([
      '--|',
      '..|',
    ])
    expect(endingRight.piece(2, 0)).toBe('ne')
    expect(endingRight.piece(2, 1)).toBe('vRight')
  })

  it('leaves lone runs and T junctions straight', () => {
    const { piece } = fences([
      '---',
      '.|.',
      '...',
      '|..',
    ])
    expect(piece(1, 0)).toBe('h')
    expect(piece(1, 1)).toBe('v')
    expect(piece(0, 3)).toBe('v')
  })

  it('joins the two real corners of Ciudad Corazón (north of the Contest Hall)', () => {
    const map = new Map(HEARTHOME.props.filter(p => p.kind === 'fenceH' || p.kind === 'fenceV').map(p => [`${p.tx},${p.ty}`, p.kind === 'fenceH' ? 'h' as const : 'v' as const]))
    const at = (tx: number, ty: number) => map.get(`${tx},${ty}`) ?? null
    const pieces = new Map<FencePiece, number>()
    for (const p of HEARTHOME.props) {
      if (p.kind !== 'fenceH' && p.kind !== 'fenceV') continue
      const piece = fencePiece(at, p.tx, p.ty)
      pieces.set(piece, (pieces.get(piece) ?? 0) + 1)
    }
    expect(fencePiece(at, 23, 7)).toBe('nw')
    expect(fencePiece(at, 39, 7)).toBe('ne')
    expect(fencePiece(at, 39, 10)).toBe('vRight')
    expect(pieces.get('nw')).toBe(1)
    expect(pieces.get('ne')).toBe(1)
  })
})

describe('plaza benches', () => {
  const town = (props: TownProp[]): TownArea => new TownArea({
    id: 'bench-test', name: 't', terrain: Array.from({ length: 6 }, () => 'pppppp'), buildings: [], fountains: [],
    props, gates: [], spawn: { tx: 0, ty: 0, dir: 'down' }, residents: [], wanderers: [],
  } satisfies TownDef)

  it('cover their whole footprint and block it', () => {
    const area = town([{ kind: 'bench', tx: 2, ty: 1 }, { kind: 'benchAcross', tx: 3, ty: 5 }])
    for (const ty of [1, 2, 3]) expect(area.isSolid(2, ty)).toBe(true)
    expect(area.isSolid(2, 4)).toBe(false)
    expect(area.isSolid(3, 5) && area.isSolid(4, 5)).toBe(true)
    expect(townPropTiles({ kind: 'benchShort', tx: 1, ty: 1 })).toEqual([{ tx: 1, ty: 1 }, { tx: 1, ty: 2 }])
  })

  it('stand on the bottom of their footprint (one-tile props keep their old feet)', () => {
    expect(townPropFeet({ kind: 'bench', tx: 2, ty: 1 })).toEqual({ x: 40, y: 63, ty: 3 })
    expect(townPropFeet({ kind: 'benchAcross', tx: 3, ty: 5 })).toEqual({ x: 64, y: 95, ty: 5 })
    expect(townPropFeet({ kind: 'lamp', tx: 2, ty: 1 })).toEqual({ x: 40, y: 30, ty: 1 })
  })

  it('in Ciudad Corazón are two long benches beside the fountains, backrest away from the water', () => {
    const benches = HEARTHOME.props.filter(p => p.kind.startsWith('bench'))
    expect(benches).toEqual([{ kind: 'bench', tx: 33, ty: 35 }, { kind: 'benchLeft', tx: 45, ty: 35 }])
    const area = new TownArea(HEARTHOME)
    for (const ty of [35, 36, 37]) expect(area.isSolid(33, ty) && area.isSolid(45, ty)).toBe(true)
  })
})

describe('street art', () => {
  const PNGS = import.meta.glob<string>('../../../../public/assets/town/{fence,bench}-*.png', { query: '?inline', import: 'default', eager: true })
  const size = (name: string) => {
    const entry = Object.entries(PNGS).find(([path]) => path.endsWith(`/${name}.png`))
    if (!entry) throw new Error(`missing ${name}`)
    const bytes = Uint8Array.from(atob(entry[1].split(',')[1]), c => c.charCodeAt(0))
    const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
    return [u32(16), u32(20)]
  }

  it('has every piece the town lists, fences as full 16 px tiles', () => {
    const fences = Object.values(HEARTHOME.art?.fences ?? {}).map(i => i.src)
    expect(fences).toHaveLength(7)
    for (const src of fences) expect(size(src.replace(/^.*\/|\.png$/g, ''))).toEqual([16, 16])
    expect(size('bench-long')).toEqual([13, 56])
    expect(size('bench-across')).toEqual([30, 19])
  })

  it('paints benches and vertical fence runs into the ground, so moving never slides them', () => {
    const f = HEARTHOME.art?.fences
    expect([f?.v?.ground, f?.vRight?.ground, HEARTHOME.art?.props?.fenceV?.[0].ground]).toEqual([true, true, true])
    for (const kind of ['bench', 'benchLeft', 'benchShort', 'benchAcross'] as const) expect(HEARTHOME.art?.props?.[kind]?.[0].ground, kind).toBe(true)
    // Straight runs and corners keep their upright pickets.
    for (const piece of ['h', 'nw', 'ne', 'sw', 'se'] as const) expect(f?.[piece]?.ground, piece).toBeUndefined()
  })

  it('no longer uses the dirt ramps as benches', () => {
    const srcs = Object.values(HEARTHOME.art?.props ?? {}).flat().map(i => i!.src)
    expect(srcs.some(s => /bench-[ab]\.png$/.test(s))).toBe(false)
  })
})
