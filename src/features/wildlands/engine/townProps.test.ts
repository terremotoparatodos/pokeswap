import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../areas/atlas'
import { fencePiece, fencePosts, fenceTileArt, type FencePiece } from './townProps'

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

describe('fence posts', () => {
  it('stand a vertical run as upright posts every 8 px, under the corner picket', () => {
    expect(fencePosts('v', 2, 3)).toEqual([{ x: 37, y: 54 }, { x: 37, y: 62 }])
    expect(fencePosts('vRight', 2, 3)).toEqual([{ x: 45, y: 54 }, { x: 45, y: 62 }])
    // A straight tile's pickets are centred on x = 5 and x = 13 of the tile.
    expect(fencePosts('h', 2, 3)).toEqual([])
  })

  it('keep the 8 px rhythm from a column into its corners', () => {
    // ┌ at (0,0): picket at y 14, then posts at 22, 30, … down the column.
    const top = [{ x: 5, y: 14 }, ...fencePosts('v', 0, 1)]
    // └ at (0,3): the column's last posts, then one more at y 54 before the picket at 62.
    const bottom = [...fencePosts('v', 0, 2), ...fencePosts('sw', 0, 3), { x: 5, y: 62 }]
    for (const run of [top, bottom]) {
      for (let i = 1; i < run.length; i++) expect(run[i].y - run[i - 1].y).toBe(8)
    }
    expect(fenceTileArt('nw')).toBe('cornerLeft')
    expect(fenceTileArt('se')).toBe('cornerRight')
    expect(fenceTileArt('v')).toBeNull()
  })
})

describe('street art', () => {
  const PNGS = import.meta.glob<string>('../../../../public/assets/town/fence-*.png', { query: '?inline', import: 'default', eager: true })
  const size = (name: string) => {
    const entry = Object.entries(PNGS).find(([path]) => path.endsWith(`/${name}.png`))
    if (!entry) throw new Error(`missing ${name}`)
    const bytes = Uint8Array.from(atob(entry[1].split(',')[1]), c => c.charCodeAt(0))
    const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
    return [u32(16), u32(20)]
  }

  it('has every fence piece the town lists', () => {
    const f = HEARTHOME.art?.fences
    expect(Object.keys(f ?? {}).sort()).toEqual(['cornerLeft', 'cornerRight', 'h', 'post'])
    for (const piece of ['h', 'cornerLeft', 'cornerRight'] as const) expect(size(f![piece]!.src.replace(/^.*\/|\.png$/g, ''))).toEqual([16, 16])
    // A post is as tall as the pickets of a straight run.
    expect(size('fence-post')).toEqual([6, 14])
  })

  it('has no benches in Ciudad Corazón', () => {
    expect(HEARTHOME.props.some(p => (p.kind as string).startsWith('bench'))).toBe(false)
  })
})
