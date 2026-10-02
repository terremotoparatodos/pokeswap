// WORLD LOCATION-1 — modelo aislado de las reglas CAS (no es parte del producto).
//
// Recorre TODAS las intercalaciones de entrega de un escenario de dos sesiones
// del mismo usuario (A: vieja, B: nueva, posiblemente en otra instancia) y
// compara tres reglas de escritura de la fila de ubicación:
//
//   epoch   fencing por epoch de sesión (claim en la base) + seq por epoch
//   clock   "última escritura gana" por timestamp del escritor (relojes con desfase)
//   counter contador monotónico por proceso, sin epoch
//
// Invariantes:
//   I1  ninguna escritura de A se aplica después del claim de B;
//   I2  si B entregó alguna escritura, la fila final es la de mayor seq de B;
//   I3  si B no entregó ninguna, la fila final no es más vieja que lo que B leyó
//       (B nunca restaura algo que luego una escritura de A cambie por debajo).
//
// Uso: node docs/design/world-location-1/cas-model.mjs

import process from 'node:process'

const RULES = {
  epoch: {
    claim: row => ({ ...row, epoch: row.epoch + 1, seq: 0 }),
    applies: (row, w) => w.epoch === row.epoch && w.seq > row.seq,
  },
  clock: {
    claim: row => row,
    // A corre en una instancia con el reloj 2 s adelantado.
    applies: (row, w) => w.ts > row.ts,
  },
  counter: {
    claim: row => row,
    // Cada proceso numera desde 0 al arrancar (la memoria no sobrevive).
    applies: (row, w) => w.seq > row.seq,
  },
}

// Eventos. A escribió a1 (entregado antes) y tiene a2 en vuelo (escritura tardía).
// B hace claim y luego escribe b1 y b2 (b2 puede adelantar a b1 en la red).
function scenario() {
  const A_SKEW = 2_000
  return [
    { id: 'A2', who: 'A', w: { epoch: 1, seq: 2, ts: 1_000 + A_SKEW, pos: 'a2' } },
    { id: 'Bc', who: 'B', claim: true },
    { id: 'B1', who: 'B', after: 'Bc', w: { epoch: 2, seq: 1, ts: 1_500, pos: 'b1' } },
    { id: 'B2', who: 'B', after: 'Bc', w: { epoch: 2, seq: 2, ts: 1_600, pos: 'b2' } },
  ]
}

function* orders(events, done = []) {
  if (events.length === 0) { yield done; return }
  for (const e of events) {
    if (e.after && !done.some(d => d.id === e.after)) continue
    yield* orders(events.filter(x => x !== e), [...done, e])
  }
}

function run(ruleName) {
  const rule = RULES[ruleName]
  let total = 0
  const failures = { I1: 0, I2: 0, I3: 0 }
  for (const order of orders(scenario())) {
    total++
    // Estado inicial: A ya escribió a1 con epoch 1.
    let row = { epoch: 1, seq: 1, ts: 900 + 2_000, pos: 'a1' }
    let claimed = false, readByB = null, bDelivered = []
    let i1 = false
    for (const e of order) {
      if (e.claim) { row = rule.claim(row); claimed = true; readByB = row.pos; continue }
      if (rule.applies(row, e.w)) {
        if (e.who === 'A' && claimed) i1 = true
        row = { ...row, ...e.w }
      }
      if (e.who === 'B') bDelivered.push(e.w)
    }
    if (i1) failures.I1++
    if (bDelivered.length > 0) {
      const best = bDelivered.reduce((m, w) => (w.seq > m.seq ? w : m))
      if (row.pos !== best.pos) failures.I2++
    } else if (row.pos !== readByB) failures.I3++
  }
  return { rule: ruleName, interleavings: total, ...failures }
}

const results = Object.keys(RULES).map(run)
console.table(results)
const ok = results.find(r => r.rule === 'epoch')
if (ok.I1 + ok.I2 + ok.I3 !== 0) { console.error('epoch rule violated an invariant'); process.exit(1) }
console.log('epoch: 0 violaciones en todas las intercalaciones.')
