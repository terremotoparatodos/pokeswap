// Ciudad Corazón terrain — hand-traced for the WildLands town layout.
//
// One character per 16px tile (64 × 51): s street, g grass, p plaza paving, t forest.
// CAVES-4: the rows are navigation data, so they live with the rest of the
// town's walkability in the shared `townLayout.js`, which the presence service
// validates against. This name stays for the art tools and the city lab.

import { TOWN_TERRAIN } from '../../../../services/realtime/src/world/townLayout.js'

export const HEARTHOME_TERRAIN: readonly string[] = TOWN_TERRAIN
