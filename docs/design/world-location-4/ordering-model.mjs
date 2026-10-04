// WORLD LOCATION-4 — modelo exhaustivo del orden de sesiones (no es parte del producto).
//
// Recorre TODAS las intercalaciones de un escenario de varias sesiones del mismo
// usuario, en una o dos instancias del realtime, contra una fila de ubicación con
// la semántica SQL de cada protocolo candidato. La red es asíncrona: un request
// puede llegar a la base en cualquier momento después de enviarse, su respuesta
// puede llegar o perderse, y la sesión puede abandonarlo (timeout) y reintentar.
// Los relojes de las instancias pueden estar desalineados (`reloj`).
//
// Protocolos:
//   actual        4d0ab64: claim condicional al epoch leído; ante conflicto, relee
//                 y reclama de nuevo (hasta 3 rondas); reintento tras abandono.
//   rebaseUnico   un solo re-base por sesión; conflicto posterior definitivo salvo
//                 que el dueño sea la propia sesión (adopción).
//   ticket        la base asigna un ticket (nextval) al primer request de cada
//                 sesión, idempotente por sesión; gana el ticket mayor.
//   ticketSinIdem igual, pero el reintento del registro pide un ticket nuevo.
//   reloj         gana el mayor timestamp de aceptación del realtime (con desfase).
//   generacion    clave (generación del host, orden de aceptación en el host); gana
//                 la clave mayor; igualdad = adopción; menor = definitivo.
//   generacionDrenaje  PROPUESTA: `generacion` + drenaje del host viejo (ver abajo).
//
// Propiedades (sobre cada traza completa):
//   R1  ninguna sesión le quita la fila a una sesión aceptada DESPUÉS que ella
//       (la vieja nunca se vuelve a imponer: T3/T4/T7);
//   R2  al final, la fila es de la pestaña abierta último (si terminó viva y con
//       respuesta definitiva). Una reconexión es la MISMA pestaña: conserva su rango;
//   S   ningún guardado se aplica con un epoch que no es el del dueño actual;
//   K   (`generacion*`) la clave (generación, orden) de la fila nunca decrece.
//
// Límites del modelo (deliberados, para que la exploración sea exhaustiva y termine):
// dos aceptaciones por escenario más las reconexiones que provoca el drenaje (una por
// pestaña), a lo sumo un abandono con su reintento por sesión, un guardado por sesión. La demostración general,
// sin estos límites, está en WORLD_LOCATION_4_DESIGN.md §3.4; el modelo la comprueba
// en los casos concretos T3/T4/T7 y encuentra los contraejemplos de las alternativas.
//
// "finales" cuenta estados finales DISTINTOS (las trazas que llegan al mismo estado
// se recorren una vez). `--trazas` imprime el contraejemplo más corto de R1 y R2.
//
// Uso: node --max-old-space-size=8192 docs/design/world-location-4/ordering-model.mjs [--trazas]

import process from 'node:process'

const E0 = 10
const GAP_MS = 250 // T7: B se acepta 250 ms después de A
const GEN = { P: 1, Q: 2 } // Q arrancó después que P: es el host vigente

const lexGreater = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
const lexEqual = (a, b) => a[0] === b[0] && a[1] === b[1]

/** Compara con la clave guardada: 'gt' | 'eq' | 'lt'. */
function byKey(cmpGreater, cmpEqual) {
  return {
    apply(db, req, sid) {
      if (req.kind !== 'claim') return null
      if (cmpGreater(req.key, db.key)) { db.epoch++; db.owner = sid; db.key = req.key; return { status: 'claimed', epoch: db.epoch } }
      if (cmpEqual(req.key, db.key) && db.owner === sid) return { status: 'claimed', epoch: db.epoch }
      return { status: 'superseded' }
    },
    answer(s, ans) {
      if (ans.status === 'claimed') return { claimed: ans.epoch }
      return { out: true }
    },
  }
}

const PROTOCOLS = {
  actual: {
    initialKey: null,
    first: s => ({ kind: 'claim', expected: s.known }),
    retry: s => { s.round = 0; return { kind: 'claim', expected: s.known } },
    apply(db, req, sid) {
      if (req.expected !== 0 && db.epoch === req.expected) { db.epoch++; db.owner = sid; return { status: 'claimed', epoch: db.epoch } }
      return { status: 'conflict', epoch: db.epoch }
    },
    answer(s, ans) {
      if (ans.status === 'claimed') return { claimed: ans.epoch }
      s.known = ans.epoch
      s.round++
      return s.round < 3 ? { send: { kind: 'claim', expected: s.known } } : { failed: true }
    },
  },
  rebaseUnico: {
    initialKey: null,
    first: s => ({ kind: 'claim', expected: s.known }),
    retry: s => ({ kind: 'claim', expected: s.known }),
    apply(db, req, sid) {
      if (req.expected !== 0 && db.epoch === req.expected) { db.epoch++; db.owner = sid; return { status: 'claimed', epoch: db.epoch } }
      return { status: 'conflict', epoch: db.epoch, mine: db.owner === sid }
    },
    answer(s, ans) {
      if (ans.status === 'claimed') return { claimed: ans.epoch }
      if (ans.mine) return { claimed: ans.epoch }
      if (s.rebased) return { out: true }
      s.rebased = true
      s.known = ans.epoch
      return { send: { kind: 'claim', expected: s.known } }
    },
  },
  ticket: ticketProtocol(true),
  ticketSinIdem: ticketProtocol(false),
  reloj: {
    initialKey: -Infinity,
    first: s => ({ kind: 'claim', key: s.stamp }),
    retry: s => ({ kind: 'claim', key: s.stamp }),
    ...byKey((a, b) => a > b, (a, b) => a === b),
  },
  generacion: {
    initialKey: [0, 0],
    first: s => ({ kind: 'claim', key: [GEN[s.host], s.hostSeq] }),
    retry: s => ({ kind: 'claim', key: [GEN[s.host], s.hostSeq] }),
    ...byKey(lexGreater, lexEqual),
  },
  // PROPUESTA completa: `generacion` + drenaje. En algún momento P renueva su lease y se
  // entera de que Q (más nuevo) está activo: desde entonces rechaza joins (el cliente
  // reconecta a Q como pestaña nueva) y cierra sus sesiones vivas con "reconectar"; esas
  // reconexiones son RESUME: la misma pestaña, que cede si en Q ya hay otra pestaña viva
  // del usuario y nunca la desplaza. `superseded` es definitivo (reemplazo).
  generacionDrenaje: {
    drains: true,
    initialKey: [0, 0],
    first: s => ({ kind: 'claim', key: [GEN[s.host], s.hostSeq] }),
    retry: s => ({ kind: 'claim', key: [GEN[s.host], s.hostSeq] }),
    ...byKey(lexGreater, lexEqual),
  },
}

function ticketProtocol(idempotent) {
  const keyed = byKey((a, b) => a > b, (a, b) => a === b)
  return {
    initialKey: 0,
    first: () => ({ kind: 'reg' }),
    retry: s => (s.ticket === null ? { kind: 'reg' } : { kind: 'claim', key: s.ticket }),
    apply(db, req, sid) {
      if (req.kind === 'reg') {
        if (!idempotent || db.tickets[sid] === undefined) db.tickets[sid] = ++db.counter
        return { status: 'ticket', ticket: db.tickets[sid] }
      }
      return keyed.apply(db, req, sid)
    },
    answer(s, ans) {
      if (ans.status === 'ticket') { s.ticket = ans.ticket; return { send: { kind: 'claim', key: s.ticket } } }
      return keyed.answer(s, ans)
    },
  }
}

// ── Escenarios ───────────────────────────────────────────────────────────

const SCENARIOS = {
  'T3/T7 · A en P (viejo), B en Q, sin abandono': { sessions: [['A', 'P'], ['B', 'Q']], giveups: 0 },
  'T4 · ídem con abandono y reintento': { sessions: [['A', 'P'], ['B', 'Q']], giveups: 1 },
  'mismo proceso · A y B en P (B reemplaza a A)': { sessions: [['A', 'P'], ['B', 'P']], giveups: 1, chain: true },
  'B aceptada en el host viejo P (A en Q)': { sessions: [['A', 'Q'], ['B', 'P']], giveups: 0 },
}

// `reloj`: P adelantado `skew` ms respecto de Q.
const SKEWS = [0, 300]

function initial(protocol, scenario, skew) {
  const sessions = {}
  scenario.sessions.forEach(([id, host], rank) => {
    sessions[id] = {
      // hostSeq (n) se asigna EN LA ACEPTACIÓN, como el contador de onJoin del host.
      id, host, rank, hostSeq: null, stamp: rank * GAP_MS + (host === 'P' ? skew : 0),
      accepted: false, live: false, phase: 'idle', req: null, known: 0, round: 0, rebased: false,
      ticket: null, epoch: null, giveups: 0, saves: 0,
    }
  })
  return {
    db: { epoch: E0, owner: null, key: protocol.initialKey, counter: 0, tickets: {} },
    sessions, reqs: [], nextReq: 1, history: [], violations: [], drained: false, accepted: { P: 0, Q: 0 },
  }
}

function actions(state, scenario, protocol) {
  const out = []
  const order = scenario.sessions.map(([id]) => id)
  const next = order.find(id => !state.sessions[id].accepted)
  if (next && (order.indexOf(next) === 0 || state.sessions[order[order.indexOf(next) - 1]].accepted)) out.push({ type: 'accept', sid: next })
  // Drenaje: P renueva su lease en algún momento y se entera de que Q (más nuevo) está activo.
  if (protocol.drains && !state.drained) out.push({ type: 'renew' })
  for (const s of Object.values(state.sessions)) {
    if (!s.accepted || !s.live) continue
    const blocked = scenario.chain && state.reqs.some(r => r.sid !== s.id && state.sessions[r.sid].host === s.host && state.sessions[r.sid].req === r.id)
    if ((s.phase === 'idle' || s.phase === 'failed') && !blocked && (s.phase === 'idle' || s.giveups <= scenario.giveups)) {
      if (s.phase === 'idle' || s.retriesLeft !== 0) out.push({ type: 'send', sid: s.id })
    }
    if (s.phase === 'claimed' && s.saves < 1) out.push({ type: 'save', sid: s.id })
  }
  for (const r of state.reqs) {
    if (!r.applied) out.push({ type: 'db', id: r.id })
    const s = state.sessions[r.sid]
    if (r.kind !== 'save' && s.req === r.id) {
      if (r.applied) out.push({ type: 'deliver', id: r.id })
      if (s.giveups < scenario.giveups) out.push({ type: 'giveup', id: r.id })
    }
  }
  return out
}

function step(state, action, protocol) {
  const st = structuredClone(state)
  const sendReq = (s, payload) => {
    const r = { id: st.nextReq++, sid: s.id, ...payload, applied: false, answer: null }
    st.reqs.push(r)
    if (payload.kind !== 'save') { s.req = r.id; s.phase = 'wait' }
  }
  if (action.type === 'renew') {
    // P drena: cierra cada sesión viva con "reconectar"; cada pestaña vuelve a Q como RESUME.
    st.drained = true
    for (const o of Object.values(st.sessions)) if (o.host === 'P' && o.live) reconnect(st, o, 'Q', true)
  } else if (action.type === 'accept') {
    const s = st.sessions[action.sid]
    s.accepted = true; s.live = true
    s.hostSeq = ++st.accepted[s.host]
    // Un host que ya drena rechaza el join: la pestaña (nueva, sin sesión previa) entra en Q.
    if (st.drained && s.host === 'P') return reconnect(st, s, 'Q', false)
    // replace(): una aceptación en un host cierra la sesión viva anterior del usuario en ESE host.
    for (const o of Object.values(st.sessions)) if (o !== s && o.host === s.host && o.live) o.live = false
  } else if (action.type === 'send') {
    const s = st.sessions[action.sid]
    const retrying = s.phase === 'failed'
    if (retrying) s.retriesLeft = 0
    sendReq(s, retrying ? protocol.retry(s) : protocol.first(s))
  } else if (action.type === 'save') {
    const s = st.sessions[action.sid]
    s.saves++
    sendReq(s, { kind: 'save', epoch: s.epoch })
  } else if (action.type === 'db') {
    const r = st.reqs.find(x => x.id === action.id)
    r.applied = true
    if (r.kind === 'save') {
      if (r.epoch === st.db.epoch && st.db.owner !== r.sid) st.violations.push(`S: guardado de ${r.sid} aplicado sin ser dueño`)
    } else {
      const before = st.db.owner
      const keyBefore = st.db.key
      r.answer = protocol.apply(st.db, r, r.sid)
      if (Array.isArray(keyBefore) && st.db.key !== keyBefore && !lexGreater(st.db.key, keyBefore)) st.violations.push('K: la clave de la fila decreció')
      if (st.db.owner !== before) {
        st.history.push(st.db.owner)
        if (before && st.sessions[before].rank > st.sessions[st.db.owner].rank) st.violations.push(`R1: ${st.db.owner} le quitó la fila a ${before} (más nueva)`)
      }
    }
  } else if (action.type === 'deliver') {
    const r = st.reqs.find(x => x.id === action.id)
    const s = st.sessions[r.sid]
    s.req = null
    if (!s.live) { s.phase = 'gone'; return st }
    const next = protocol.answer(s, r.answer)
    if (next.claimed !== undefined) { s.phase = 'claimed'; s.epoch = next.claimed } else if (next.out) s.phase = 'out'
    else if (next.failed) { s.phase = 'failed'; s.retriesLeft = 0 } else sendReq(s, next.send)
  } else if (action.type === 'giveup') {
    const r = st.reqs.find(x => x.id === action.id)
    const s = st.sessions[r.sid]
    s.req = null; s.giveups++; s.phase = 'failed'; s.retriesLeft = 1
  }
  return st
}

/**
 * La pestaña `s` vuelve a entrar en `host` (el vigente). Es la MISMA pestaña: conserva su
 * rango (orden de apertura). Con `resume` (la cerró un drenaje) cede si en ese host ya hay
 * otra pestaña viva del usuario; sin `resume` (su join fue rechazado: nunca jugó) es una
 * aceptación normal y reemplaza a la sesión viva de ese host.
 */
function reconnect(st, s, host, resume) {
  s.phase = 'gone'; s.live = false
  const id = `${s.id}'`
  if (st.sessions[id]) return st // una sola reconexión por pestaña en el modelo
  const hostSeq = ++st.accepted[host]
  const others = Object.values(st.sessions).filter(x => x.host === host && x.live)
  const yields = resume && others.length > 0
  st.sessions[id] = { ...structuredClone(s), id, host, hostSeq, accepted: true, live: !yields, phase: yields ? 'yielded' : 'idle', req: null, giveups: 0, saves: 0, epoch: null }
  if (!yields) for (const o of others) o.live = false
  return st
}

function finalCheck(state) {
  // La pestaña abierta último (con sus reconexiones, que conservan el rango).
  const maxRank = Math.max(...Object.values(state.sessions).map(x => x.rank))
  const tab = Object.values(state.sessions).filter(x => x.rank === maxRank)
  const live = tab.find(x => x.live && ['claimed', 'out', 'fenced'].includes(x.phase))
  if (live && state.db.owner !== live.id) return `R2: la fila terminó en ${state.db.owner}, no en ${live.id}`
  if (!live && tab.some(x => x.phase === 'yielded')) return `R2: la pestaña más nueva (${tab[0].id}) cedió al reconectar`
  return null
}

function explore(protocolName, scenarioName, skew = 0) {
  const protocol = PROTOCOLS[protocolName]
  const scenario = SCENARIOS[scenarioName]
  const seen = new Set()
  const result = { terminals: 0, R1: 0, R2: 0, S: 0, K: 0, example: { R1: null, R2: null } }
  const visit = (state, trail) => {
    // Los requests ya resueltos no influyen en el futuro: fuera de la clave de estado.
    const open = state.reqs.filter(r => !r.applied || (r.kind !== 'save' && state.sessions[r.sid].req === r.id))
    const key = JSON.stringify([state.db, state.sessions, open, state.history, state.violations, state.drained, state.accepted])
    if (seen.has(key)) return
    seen.add(key)
    const next = actions(state, scenario, protocol)
    if (next.length === 0) {
      result.terminals++
      const v = [...state.violations]
      const r2 = finalCheck(state)
      if (r2) v.push(r2)
      for (const kind of ['R1', 'R2', 'S', 'K']) {
        if (v.some(x => x.startsWith(kind))) {
          result[kind]++
          if ((kind === 'R1' || kind === 'R2') && (!result.example[kind] || trail.length < result.example[kind].length)) result.example[kind] = [...trail, `⇒ ${v.find(x => x.startsWith(kind))}`]
        }
      }
      return
    }
    for (const a of next) {
      const st = step(state, a, protocol)
      visit(st, [...trail, describe(state, a, st)])
    }
  }
  visit(initial(protocol, scenario, skew), [])
  return { ...result, states: seen.size }
}

function describe(before, action, after) {
  if (action.type === 'renew') return 'P renueva su lease: Q está activo → P drena (cierra con "reconectar")'
  if (action.type === 'accept') return `acepta ${action.sid}@${after.sessions[action.sid].host}`
  if (action.type === 'send' || action.type === 'save') {
    const r = after.reqs.at(-1)
    return `${action.sid} envía ${r.kind}${r.expected !== undefined ? `(${r.expected})` : r.key !== undefined ? `(${JSON.stringify(r.key)})` : r.epoch !== undefined ? `(e${r.epoch})` : ''}`
  }
  const r = after.reqs.find(x => x.id === action.id)
  if (action.type === 'db') return `base aplica ${r.sid}.${r.kind} → ${r.kind === 'save' ? (r.epoch === before.db.epoch ? 'applied' : 'stale') : `${r.answer.status}${r.answer.epoch ?? r.answer.ticket ?? ''}`} (dueño ${after.db.owner ?? '—'}, e${after.db.epoch})`
  if (action.type === 'deliver') {
    const resent = after.reqs.length > before.reqs.length ? after.reqs.at(-1) : null
    const arg = resent && (resent.expected !== undefined ? resent.expected : JSON.stringify(resent.key))
    return `${r.sid} recibe ${r.answer.status}${resent ? ` → reenvía ${resent.kind}(${arg})` : ''}`
  }
  return `${r.sid} abandona su ${r.kind} (timeout)`
}

// ── Ejecución ────────────────────────────────────────────────────────────

const verbose = process.argv.includes('--trazas')
const rows = []
for (const protocolName of Object.keys(PROTOCOLS)) {
  for (const scenarioName of Object.keys(SCENARIOS)) {
    for (const skew of protocolName === 'reloj' ? SKEWS : [0]) {
      const r = explore(protocolName, scenarioName, skew)
      rows.push({ protocolo: protocolName + (protocolName === 'reloj' ? ` (P +${skew} ms)` : ''), escenario: scenarioName, estados: r.states, finales: r.terminals, R1: r.R1, R2: r.R2, S: r.S, K: protocolName.startsWith('generacion') ? r.K : '—' })
      if (verbose) for (const kind of ['R1', 'R2']) if (r.example[kind]) console.log(`\n${protocolName}${protocolName === 'reloj' ? ` +${skew}` : ''} · ${scenarioName} · contraejemplo ${kind} más corto:\n  ${r.example[kind].join('\n  ')}`)
    }
  }
}
console.table(rows)
