// POKÉMON ECOSYSTEM-1 · cálculos reproducibles (sólo lectura).
//
//   node docs/design/pokemon-ecosystem-1/ecosystem_calc.mjs
//
// Lee el catálogo de batalla (core.json), los sprites de public/assets/overworld
// y el layout de la cueva (caveLayouts.js). No escribe nada. Determinista: todo
// son valores esperados, sin azar. Los números de entrada son PROPUESTAS de
// playtest de POKEMON_ECOSYSTEM_1_PROPOSAL.md, no balance aprobado.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const core = JSON.parse(readFileSync(join(ROOT, 'src/features/battle/catalog/generated/core.json'), 'utf8'))
const { caveInterior } = await import(new URL('file://' + join(ROOT, 'services/realtime/src/world/caveLayouts.js').replace(/\\/g, '/')).href)

const species = new Map(core.species.map(s => [s.id, s]))
const types = new Map(core.forms.filter(f => f.isDefault).map(f => [f.speciesId, f.types]))
const r1 = x => Math.round(x * 10) / 10
const r2 = x => Math.round(x * 100) / 100
const pct = x => `${r2(100 * x)} %`

// ── A · Catálogo propuesto (§A del documento) ─────────────────────────────
// [id, nombre esperado, familia (id de la base), etapa, tier, peso, grupo [min,max]]
const TABLES = {
  'pradera.abierta': [
    [16, 'pidgey', 16, 1, 'common', 28, [1, 3]],
    [19, 'rattata', 19, 1, 'common', 28, [1, 2]],
    [399, 'bidoof', 399, 1, 'common', 14, [1, 2]],
    [29, 'nidoran-f', 29, 1, 'uncommon', 6, [1, 1]],
    [32, 'nidoran-m', 32, 1, 'uncommon', 6, [1, 1]],
    [187, 'hoppip', 187, 1, 'uncommon', 6, [1, 2]],
    [403, 'shinx', 403, 1, 'uncommon', 6, [1, 1]],
    [17, 'pidgeotto', 16, 2, 'rare', 2, [1, 1]],
    [20, 'raticate', 19, 2, 'rare', 1.5, [1, 1]],
    [25, 'pikachu', 172, 2, 'rare', 2, [1, 1]],
    [30, 'nidorina', 29, 2, 'very_rare', 0.25, [1, 1]],
    [33, 'nidorino', 32, 2, 'very_rare', 0.25, [1, 1]],
  ],
  'pradera.bosque': [
    [10, 'caterpie', 10, 1, 'common', 26, [1, 3]],
    [13, 'weedle', 13, 1, 'common', 26, [1, 3]],
    [43, 'oddish', 43, 1, 'common', 18, [1, 2]],
    [11, 'metapod', 10, 2, 'uncommon', 6, [1, 2]],
    [14, 'kakuna', 13, 2, 'uncommon', 6, [1, 2]],
    [204, 'pineco', 204, 1, 'uncommon', 6, [1, 1]],
    [165, 'ledyba', 165, 1, 'uncommon', 6, [1, 2]],
    [44, 'gloom', 43, 2, 'rare', 2, [1, 1]],
    [17, 'pidgeotto', 16, 2, 'rare', 1.5, [1, 1]],
    [166, 'ledian', 165, 2, 'rare', 1, [1, 1]],
    [25, 'pikachu', 172, 2, 'rare', 1, [1, 1]],
    [205, 'forretress', 204, 2, 'very_rare', 0.5, [1, 1]],
  ],
  'cueva-inicial': [
    [41, 'zubat', 41, 1, 'common', 30, [2, 3]],
    [74, 'geodude', 74, 1, 'common', 28, [1, 2]],
    [293, 'whismur', 293, 1, 'common', 12, [1, 1]],
    [50, 'diglett', 50, 1, 'uncommon', 9, [1, 1]],
    [46, 'paras', 46, 1, 'uncommon', 8, [1, 1]],
    [27, 'sandshrew', 27, 1, 'uncommon', 7, [1, 1]],
    [75, 'graveler', 74, 2, 'rare', 2, [1, 1]],
    [42, 'golbat', 41, 2, 'rare', 1.5, [1, 1]],
    [185, 'sudowoodo', 438, 2, 'rare', 1, [1, 1]],
    [294, 'loudred', 293, 2, 'rare', 1, [1, 1]],
    [206, 'dunsparce', 206, 1, 'very_rare', 0.5, [1, 1]],
  ],
}
// Categorías que ninguna tabla ordinaria puede contener (CAVE_TYPES_AND_FAMILIES §4.3, MMO §6).
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const LEGENDARY = [144, 145, 146, 150, 243, 244, 245, 249, 250, ...range(377, 384), ...range(480, 488)]
const MYTHICAL = [151, 251, 385, 386, ...range(489, 493)]
const PSEUDO = [147, 148, 149, 246, 247, 248, ...range(371, 376), 443, 444, 445]
const STARTER = [...range(1, 9), ...range(152, 160), ...range(252, 260), ...range(387, 395)]
const FOSSIL = [...range(138, 142), ...range(345, 348), ...range(408, 411)]
const EEVEE = [133, 134, 135, 136, 196, 197, 470, 471]
const FORBIDDEN = new Map([...LEGENDARY.map(i => [i, 'legendario']), ...MYTHICAL.map(i => [i, 'mítico']), ...PSEUDO.map(i => [i, 'pseudo']), ...STARTER.map(i => [i, 'starter']), ...FOSSIL.map(i => [i, 'fósil']), ...EEVEE.map(i => [i, 'eevee'])])

console.log('## A · Verificación del catálogo (core.json + sprites)')
let problems = 0
for (const [table, rows] of Object.entries(TABLES)) {
  const shares = {}
  let total = 0
  for (const [id, name, , , tier, weight] of rows) {
    const s = species.get(id)
    const ow = existsSync(join(ROOT, `public/assets/overworld/${String(id).padStart(4, '0')}.png`))
    const shiny = existsSync(join(ROOT, `public/assets/overworld/shiny/${String(id).padStart(4, '0')}.png`))
    if (!s || s.name !== name) { problems++; console.log(`  ✗ ${table}: ${id} esperado ${name}, catálogo ${s?.name}`) }
    if (!ow || !shiny) { problems++; console.log(`  ✗ ${table}: ${id} sin sprite overworld${ow ? '' : ' normal'}${shiny ? '' : ' shiny'}`) }
    if (FORBIDDEN.has(id)) { problems++; console.log(`  ✗ ${table}: ${id} es ${FORBIDDEN.get(id)}`) }
    shares[tier] = (shares[tier] ?? 0) + weight
    total += weight
  }
  const line = rows.map(([id, name, , , tier, w, g]) => `${id} ${name} [${types.get(id).join('/')}] cr ${species.get(id).catchRate} · ${tier} ${w} · grupo ${g.join('–')}`)
  console.log(`\n${table} (suma de pesos ${total})`)
  for (const l of line) console.log(`  ${l}`)
  console.log(`  shares: ${Object.entries(shares).map(([t, w]) => `${t} ${r1(100 * w / total)}`).join(' · ')}`)
}
console.log(`\nproblemas: ${problems}`)

// ── B · Población: tamaño de la cueva y miembros esperados por nido ───────
console.log('\n## B · Población')
const cave = caveInterior('cueva-inicial')
const floor = cave.rows.join('').split('').filter(c => c !== '#').length
console.log(`cueva-inicial: ${cave.width}×${cave.height}, ${floor} casillas de suelo`)
for (const [table, rows] of Object.entries(TABLES)) {
  const total = rows.reduce((s, r) => s + r[5], 0)
  const meanGroup = rows.reduce((s, [, , , , , w, [a, b]]) => s + (w / total) * (a + b) / 2, 0)
  console.log(`${table}: miembros esperados por aparición de nido = ${r2(meanGroup)}`)
}
// Oferta: un nido rinde un grupo por ciclo (respawn + vida media).
const SUPPLY = {
  'pradera.abierta': { nests: p => Math.min(8, 3 + Math.ceil(p / 2)), respawn: 75, alive: 45 },
  'pradera.bosque': { nests: p => Math.min(5, 2 + Math.ceil(p / 3)), respawn: 75, alive: 45 },
  'cueva-inicial': { nests: p => Math.min(4, 2 + Math.ceil(p / 4)), respawn: 90, alive: 45 },
}
const meanGroupOf = t => { const rows = TABLES[t], total = rows.reduce((s, r) => s + r[5], 0); return rows.reduce((s, [, , , , , w, [a, b]]) => s + (w / total) * (a + b) / 2, 0) }
console.log('\nencuentros ofrecidos por hora (todos los jugadores de esa zona) · por jugador')
for (const p of [1, 5, 10, 30]) {
  const cells = Object.entries(SUPPLY).map(([t, s]) => {
    const perH = s.nests(p) * 3600 / (s.respawn + s.alive) * meanGroupOf(t)
    return `${t} ${s.nests(p)} nidos → ${Math.round(perH)}/h (${r1(perH / p)}/jug)`
  })
  console.log(`  ${String(p).padStart(2)} jugadores en la zona: ${cells.join(' · ')}`)
}

// ── C · Drops: Esencias por derrota y reglas de doble tipo ────────────────
console.log('\n## C · Esencias por derrota')
// Base por etapa: 1 / 2 (ninguna tabla inicial tiene etapa 3). Reglas para doble tipo:
//  R1 = sólo primario · R2 = primario + 25 % secundario (CAVE_RESPAWN §5.2) · R3 = reparto (total fijo; cada unidad 2/3 primario, 1/3 secundario)
const STAGE_BASE = { 1: 1, 2: 2 }
function perDefeat(table, rule) {
  const rows = TABLES[table], total = rows.reduce((s, r) => s + r[5], 0)
  const byType = {}
  let units = 0
  for (const [id, , , stage, , w] of rows) {
    const share = w / total, base = STAGE_BASE[stage], [t1, t2] = types.get(id)
    const add = (t, v) => { byType[t] = (byType[t] ?? 0) + v; units += v }
    if (!t2 || rule === 'R1') add(t1, share * base)
    else if (rule === 'R2') { add(t1, share * base); add(t2, share * 0.25) }
    else { add(t1, share * base * 2 / 3); add(t2, share * base / 3) }
  }
  return { units, byType }
}
for (const table of Object.keys(TABLES)) {
  for (const rule of ['R1', 'R2', 'R3']) {
    const { units, byType } = perDefeat(table, rule)
    const top = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${r2(v)}`).join(' · ')
    console.log(`${table} ${rule}: ${r2(units)} Esencias/derrota → ${top}`)
  }
}
// Recursos por hora. Supuestos: derrotas/h por ritmo (la búsqueda + combate de COMBAT-1 no existe:
// se usan 3 escenarios), sin tope blando (no se alcanza), regla R3.
console.log('\nEsencias por hora (regla R3; derrotas/h: tranquilo 18, activo 30, intenso 45)')
const PACE = { tranquilo: 18, activo: 30, intenso: 45 }
for (const table of Object.keys(TABLES)) {
  const { units, byType } = perDefeat(table, 'R3')
  const cells = Object.entries(PACE).map(([k, d]) => `${k} ${r1(units * d)}/h`)
  const best = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]
  console.log(`${table}: ${cells.join(' · ')} · tipo principal ${best[0]} ${r1(best[1] * PACE.activo)}/h (activo)`)
}

// ── D · Huevos ────────────────────────────────────────────────────────────
console.log('\n## D · Huevos')
const OWNER = { comun: 80, raro: 15, epico: 3.9, legendario: 0.1 }
const sum = Object.values(OWNER).reduce((a, b) => a + b, 0)
console.log(`distribución del dueño: suma ${r2(sum)} % (falta ${r2(100 - sum)} %)`)
const ALTS = {
  'A · Común absorbe': { comun: 81, raro: 15, epico: 3.9, legendario: 0.1 },
  'B · Raro absorbe': { comun: 80, raro: 16, epico: 3.9, legendario: 0.1 },
  'C · Épico absorbe': { comun: 80, raro: 15, epico: 4.9, legendario: 0.1 },
  'D · Legendario absorbe': { comun: 80, raro: 15, epico: 3.9, legendario: 1.1 },
  'E · Proporcional': Object.fromEntries(Object.entries(OWNER).map(([k, v]) => [k, 100 * v / sum])),
}
for (const [name, d] of Object.entries(ALTS)) {
  const t = Object.values(d).reduce((a, b) => a + b, 0)
  const epicPlus = (d.epico + d.legendario) / 100
  console.log(`${name}: ${Object.entries(d).map(([k, v]) => `${k} ${r2(v)}`).join(' · ')} (suma ${r2(t)}) · E[huevos hasta Épico+] ${r1(1 / epicPlus)} · E[hasta Legendario] ${Math.round(100 / d.legendario)} · P(≥1 Legendario en 100 huevos) ${pct(1 - (1 - d.legendario / 100) ** 100)}`)
}
// Pools por tipo: especies cuya familia está en las tablas (forma base no bebé), por cualquiera de sus tipos.
// Común = base de familias con alguna entrada common/uncommon; Raro = base de familias cuya mejor entrada es rare;
// Épico = base de familias cuya mejor entrada es very_rare. Legendario = sin pool definido (decisión pendiente).
const TIER_RANK = { common: 0, uncommon: 1, rare: 2, very_rare: 3 }
const familyBest = new Map()
for (const rows of Object.values(TABLES)) for (const [, , fam, , tier] of rows) {
  const prev = familyBest.get(fam)
  if (prev === undefined || TIER_RANK[tier] < prev) familyBest.set(fam, TIER_RANK[tier])
}
// Bases de huevo: la base no bebé de cada familia (Pichu 172 → Pikachu 25; Bonsly 438 → Sudowoodo 185).
const EGG_BASE = { 172: 25, 438: 185 }
const eggTier = rank => (rank <= 1 ? 'comun' : rank === 2 ? 'raro' : 'epico')
const pools = {}
for (const [fam, rank] of familyBest) {
  const base = EGG_BASE[fam] ?? fam
  for (const t of types.get(base)) {
    pools[t] ??= { comun: [], raro: [], epico: [], legendario: [] }
    pools[t][eggTier(rank)].push(species.get(base).name)
  }
}
console.log('\npools por tipo de huevo (sólo familias de Pradera + cueva):')
for (const t of Object.keys(pools).sort()) {
  const p = pools[t]
  const complete = p.comun.length && p.raro.length && p.epico.length
  console.log(`  ${t.padEnd(8)} común [${p.comun.join(', ')}] · raro [${p.raro.join(', ')}] · épico [${p.epico.join(', ')}] · legendario [] → ${complete ? 'tres tiers con especies' : 'INCOMPLETO'}`)
}
// Borrador ilustrativo (§D.3): pools curados para los dos tipos con más producción inicial.
// Común = familias de las tablas; Raro y Épico = familias del tipo que NO aparecen en las tablas iniciales.
const EGG_DRAFT = {
  normal: { comun: [16, 19, 399, 293], raro: [216, 300, 190], epico: [206, 128, 115], legendario: [] },
  bug: { comun: [10, 13, 165, 204, 46], raro: [48, 167, 213], epico: [123, 127, 214], legendario: [] },
}
console.log('\nborrador de pools curados (verificación de tipo, categoría prohibida y sprites):')
for (const [egg, tiers] of Object.entries(EGG_DRAFT)) {
  for (const [tier, ids] of Object.entries(tiers)) {
    const cells = ids.map(id => {
      const ok = types.get(id).includes(egg) && !FORBIDDEN.has(id) && existsSync(join(ROOT, `public/assets/overworld/${String(id).padStart(4, '0')}.png`))
      if (!ok) problems++
      return `${id} ${species.get(id).name} [${types.get(id).join('/')}] cr ${species.get(id).catchRate}${ok ? '' : ' ✗'}`
    })
    console.log(`  ${egg} · ${tier}: ${cells.join(' · ') || '— (decisión pendiente)'}`)
  }
}
console.log(`problemas acumulados: ${problems}`)
// Costo y tiempo: horas de juego activo para juntar el costo con la producción de §C.
console.log('\nhoras de juego (ritmo activo, 30 derrotas/h, R3) para pagar un huevo de cada costo')
const focus = {}
for (const table of Object.keys(TABLES)) for (const [t, v] of Object.entries(perDefeat(table, 'R3').byType)) focus[t] = Math.max(focus[t] ?? 0, v * PACE.activo)
for (const cost of [20, 40, 60]) {
  console.log(`  costo ${cost}: ${Object.entries(focus).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${r1(cost / v)} h`).join(' · ')}`)
}
// Pasos de incubación: minutos de juego para cada propuesta, según cuánto se camina.
console.log('\nincubación: minutos de juego hasta eclosionar (pasos válidos por segundo de juego)')
const STEPS = { comun: 1500, raro: 3000, epico: 6000, legendario: 10000 }
const RATE = { 'paseo 1,0/s': 1.0, 'mixto 2,0/s': 2.0, 'caminata 3,75/s': 3.75 }
for (const [tier, steps] of Object.entries(STEPS)) {
  console.log(`  ${tier.padEnd(10)} ${String(steps).padStart(5)} pasos: ${Object.entries(RATE).map(([k, v]) => `${k} → ${r1(steps / v / 60)} min`).join(' · ')}`)
}
console.log(`  techo del servidor: ${10} pasos/s sostenidos (MOVE_TOKENS_PER_SECOND) → común en ${r1(STEPS.comun / 10 / 60)} min como mínimo absoluto`)
