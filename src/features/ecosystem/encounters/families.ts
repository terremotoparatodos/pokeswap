// Evolutionary families referenced by the ECO-1 encounter tables.
//
// The battle catalog has no evolution data (gap H1, CAVE_TYPES_AND_FAMILIES.md
// §4.2), so this is authored, canonical knowledge (INFERENCE). Ids and slugs
// are FACT: the tests check every member against `core.json`.
//
// A family is NOT a spawn group: the family says who evolves into whom; the
// entry's `group` says how many appear together.
//
// Only the families the tables use are listed. Adding a family here does not
// make it spawn: only an encounter entry does.

import type { EncounterFamily, EncounterFamilyMember } from './types'

const SOURCE_NOTE = 'canonical evolution lines (INFERENCE, gap H1); ids and slugs verified against core.json'
export const FAMILIES_SOURCE: string = SOURCE_NOTE

const m = (speciesId: number, speciesName: string, stage: 1 | 2 | 3, baby = false): EncounterFamilyMember =>
  baby ? { speciesId, speciesName, stage, baby: true } : { speciesId, speciesName, stage }

const family = (...members: EncounterFamilyMember[]): EncounterFamily => ({ id: members[0].speciesId, members })

export const ENCOUNTER_FAMILIES: readonly EncounterFamily[] = [
  family(m(16, 'pidgey', 1), m(17, 'pidgeotto', 2), m(18, 'pidgeot', 3)),
  family(m(19, 'rattata', 1), m(20, 'raticate', 2)),
  family(m(399, 'bidoof', 1), m(400, 'bibarel', 2)),
  family(m(29, 'nidoran-f', 1), m(30, 'nidorina', 2), m(31, 'nidoqueen', 3)),
  family(m(32, 'nidoran-m', 1), m(33, 'nidorino', 2), m(34, 'nidoking', 3)),
  family(m(187, 'hoppip', 1), m(188, 'skiploom', 2), m(189, 'jumpluff', 3)),
  family(m(403, 'shinx', 1), m(404, 'luxio', 2), m(405, 'luxray', 3)),
  family(m(172, 'pichu', 1, true), m(25, 'pikachu', 2), m(26, 'raichu', 3)),
  family(m(10, 'caterpie', 1), m(11, 'metapod', 2), m(12, 'butterfree', 3)),
  family(m(13, 'weedle', 1), m(14, 'kakuna', 2), m(15, 'beedrill', 3)),
  family(m(43, 'oddish', 1), m(44, 'gloom', 2), m(45, 'vileplume', 3), m(182, 'bellossom', 3)),
  family(m(204, 'pineco', 1), m(205, 'forretress', 2)),
  family(m(165, 'ledyba', 1), m(166, 'ledian', 2)),
  family(m(41, 'zubat', 1), m(42, 'golbat', 2), m(169, 'crobat', 3)),
  family(m(74, 'geodude', 1), m(75, 'graveler', 2), m(76, 'golem', 3)),
  family(m(293, 'whismur', 1), m(294, 'loudred', 2), m(295, 'exploud', 3)),
  family(m(50, 'diglett', 1), m(51, 'dugtrio', 2)),
  family(m(46, 'paras', 1), m(47, 'parasect', 2)),
  family(m(27, 'sandshrew', 1), m(28, 'sandslash', 2)),
  family(m(438, 'bonsly', 1, true), m(185, 'sudowoodo', 2)),
  family(m(206, 'dunsparce', 1)),
]
