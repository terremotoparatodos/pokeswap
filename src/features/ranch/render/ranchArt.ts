// Sprite registry — Rancho
//
// Builds every drawn sprite the ranch needs, once, at start-up: the props from
// ranchLayout, the wild decor (trees, pines, bushes, rocks) and the fence
// pieces. Everything here is painted in code, so there is nothing to await and
// the first frame is already complete. Pokémon and the two trainers are images
// and load separately (see residents.ts).

import { buildPropSprites } from '../../wildlands/engine/props'
import type { Sprite } from '../../wildlands/engine/sprite'
import { buildTownProps } from '../../wildlands/engine/townProps'
import type { DecorKind } from '../../wildlands/engine/world'
import { buildArch, buildBarn, buildHouse, buildMailbox, buildWell } from '../art/buildingArt'
import { buildEmotes, type Emote } from '../art/emoteArt'
import {
  buildBasket, buildBerryPlant, buildCampfire, buildCrate, buildFlowerpot, buildHay, buildHayStack,
  buildLogSeat, buildReeds, buildScarecrow, buildSunflower, buildTrough,
} from '../art/farmArt'
import { buildFenceSprites } from '../art/fenceArt'
import type { PropKind } from '../world/ranchLayout'

/** Width of the entrance arch, in pixels: seven tiles across the path. */
const ARCH_WIDTH = 7 * 16

export interface RanchArt {
  /** Variants per prop kind; `variant` on the PropDef picks one. */
  props: Record<PropKind, Sprite[]>
  /** Kinds whose variants are animation frames rather than alternatives. */
  animated: ReadonlySet<PropKind>
  decor: Record<DecorKind, Sprite>
  /** Indexed by neighbour mask, 0–15. */
  fence: Sprite[]
  emotes: Record<Emote, Sprite>
}

export function buildRanchArt(): RanchArt {
  const town = buildTownProps()
  const props: Record<PropKind, Sprite[]> = {
    house: [buildHouse()],
    barn: [buildBarn()],
    arch: [buildArch(ARCH_WIDTH)],
    well: [buildWell()],
    mailbox: [buildMailbox()],
    signpost: [town.sign],
    lamp: [town.lamp],
    bench: [town.bench],
    hay: [buildHay()],
    hayStack: [buildHayStack()],
    trough: [buildTrough()],
    berry: [0, 1, 2, 3].map(buildBerryPlant),
    sunflower: [buildSunflower()],
    scarecrow: [buildScarecrow()],
    campfire: buildCampfire(),
    log: [0, 1].map(buildLogSeat),
    crate: [0, 1].map(buildCrate),
    reeds: [buildReeds()],
    flowerpot: [0, 1].map(buildFlowerpot),
    basket: [buildBasket()],
  }
  return {
    props,
    animated: new Set<PropKind>(['campfire']),
    decor: buildPropSprites(),
    fence: buildFenceSprites(),
    emotes: buildEmotes(),
  }
}

/** The sprite for a prop: its variant, or the current frame when animated. */
export function propSprite(art: RanchArt, kind: PropKind, variant = 0, frame = 0): Sprite {
  const list = art.props[kind]
  const index = art.animated.has(kind) ? frame % list.length : variant % list.length
  return list[index]
}
