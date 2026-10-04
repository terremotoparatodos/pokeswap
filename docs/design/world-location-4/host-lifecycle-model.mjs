// WORLD LOCATION-4 (revisión C1/C2) — modelo exhaustivo del ciclo de vida de hosts
// (no es parte del producto).
//
// Recorre TODAS las intercalaciones de: requests de varios procesos realtime contra las
// funciones SQL propuestas (acquire, activate, renew, drain, stop, claim con clave y save),
// llegada en cualquier orden, respuesta perdida con reintento, caída de un candidato, y el
// paso del tiempo de la base (`now()` en ticks; leases de L ticks).
//
// Además del protocolo propuesto (§7.4 del informe) corre MUTANTES: cada uno quita o
// cambia una regla. Un mutante debe ser DETECTADO (alguna propiedad violada en algún
// escenario); si no, la regla quitada no está cubierta y se informa.
//
// Escenarios (C1):
//   S1  un candidato arranca y falla antes de estar listo
//   S2  un candidato lento (su lease de arranque puede vencer antes de activar)
//   S3  dos candidatos concurrentes
//   S4  respuesta perdida durante acquire y activate (reintento)
//   S5  intento de reactivar un host draining o stopped (y de renovarlo / guardar)
//   S6  claims y guardados "hostiles" fuera de estado (C2): un candidato starting reclama y
//       guarda con el epoch vigente; el vigente reclama con el lease vencido. La BASE debe
//       rechazarlos aunque el realtime tenga un bug.
//   S7  un host draining que ya perdió la fila intenta guardar adivinando el epoch vigente.
// Todo guardado "hostil" usa el epoch VIGENTE de la fila (el peor caso: el CAS de epoch no
// lo frena; solo lo frenan las reglas de estado y de dueño).
// En todos, P es el host vigente (active, dueño de la fila).
//
// Propiedades:
//   H1  `newerActive` solo es verdadero si existe un host más nuevo ACTIVO, activado por
//       él mismo tras estar listo y con lease vigente (un starting nunca drena al vigente)
//   H2  el estado de cada host es monótono: starting → active → draining → stopped
//   H3  un hostId tiene una sola generación; acquire nunca cambia el estado de un host
//       existente; el reintento devuelve la misma generación y el mismo estado
//   H4  un claim solo se aplica desde un host active con lease vigente; un guardado solo
//       desde active con lease vigente, o draining con lease vigente sobre una fila propia
//   H5  una activación solo ocurre desde starting, con lease vigente y sin un host más
//       nuevo activo
//   H6  (final) un host que supo de uno más nuevo termina draining o stopped
//   H7  (final) un candidato caído antes de estar listo nunca quedó activo, y el vigente
//       sigue activo si nadie más se activó
//
// Uso: node docs/design/world-location-4/host-lifecycle-model.mjs

import process from 'node:process'

const L = 2 // lease en ticks de la base
const MAX_NOW = 2
const RANK = { starting: 0, active: 1, draining: 2, stopped: 3 }

const MUTANTS = {
  propuesta: {},
  acquireCreaActive: { acquireActive: true }, // el §7.4 original
  newerCuentaStarting: { newerCountsStarting: true },
  acquireNoIdempotente: { acquireNotIdempotent: true },
  activateSinEstado: { activateNoState: true },
  activateSinLease: { activateNoLease: true },
  activateSinMasNuevo: { activateNoHigher: true },
  claimSoloIdentidad: { claimIdentityOnly: true }, // el §7.4 original
  claimSinLease: { claimNoLease: true },
  saveSinEstado: { saveNoState: true },
  drainingSaveSinDueño: { drainSaveNoOwner: true },
  renewReactiva: { renewRevives: true },
}

// ── Reglas SQL (propuesta, con los mutantes como interruptores) ─────────────

const leaseOk = (db, h) => h.lease > db.now
const higherActive = (db, gen, m = {}) => Object.values(db.hosts).some(h => h.gen > gen && (h.state === 'active' || (m.newerCountsStarting && h.state === 'starting')) && leaseOk(db, h))
const identity = (db, p) => { const h = db.hosts[p.gen]; return h && h.hostId === p.hostId ? h : null }

function applyOp(db, op, p, m) {
  switch (op) {
    case 'acquire': {
      let h = Object.values(db.hosts).find(x => x.hostId === p.hostId)
      if (!h || m.acquireNotIdempotent) {
        const gen = ++db.nextGen
        h = { gen, hostId: p.hostId, state: m.acquireActive ? 'active' : 'starting', lease: db.now + L, ready: false }
        db.hosts[gen] = h
      }
      return { status: 'ok', gen: h.gen, state: h.state }
    }
    case 'activate': {
      const h = identity(db, p)
      if (!h) return { status: 'unknown_host' }
      if (h.state === 'active' && !m.activateNoState) return { status: 'active' } // reintento idempotente
      if (h.state !== 'starting' && !m.activateNoState) return { status: 'host_inactive' }
      if (!leaseOk(db, h) && !m.activateNoLease) return { status: 'host_expired' }
      if (higherActive(db, h.gen) && !m.activateNoHigher) return { status: 'newer_active' }
      h.state = 'active'; h.lease = db.now + L; h.ready = true
      return { status: 'active' }
    }
    case 'renew': {
      const h = identity(db, p)
      if (!h) return { status: 'unknown_host' }
      if (m.renewRevives && (h.state === 'stopped' || h.state === 'draining')) { h.state = 'active'; h.lease = db.now + L }
      if (h.state === 'stopped') return { status: 'host_inactive' }
      if (h.state === 'starting' && !leaseOk(db, h)) return { status: 'host_expired' }
      const newer = higherActive(db, h.gen, m)
      // Un active vencido solo revive si no hay uno más nuevo activo. Un draining no se
      // extiende: su ventana de flush la fija drain.
      if (h.state !== 'draining' && !(h.state === 'active' && !leaseOk(db, h) && newer)) h.lease = db.now + L
      return { status: 'ok', state: h.state, newerActive: newer }
    }
    case 'drain': {
      const h = identity(db, p)
      if (!h) return { status: 'unknown_host' }
      if (h.state === 'active') { h.state = 'draining'; h.lease = db.now + L }
      else if (h.state === 'starting') h.state = 'stopped'
      return { status: h.state === 'stopped' ? 'host_inactive' : 'ok', state: h.state }
    }
    case 'stop': {
      const h = identity(db, p)
      if (h) h.state = 'stopped'
      return { status: 'ok' }
    }
    case 'claim': {
      const h = identity(db, p)
      if (!h) return { status: 'unknown_host' }
      if (!m.claimIdentityOnly) {
        if (h.state !== 'active') return { status: 'host_inactive' }
        if (!leaseOk(db, h) && !m.claimNoLease) return { status: 'host_expired' }
      }
      const r = db.row
      if (p.gen > r.og || (p.gen === r.og && p.seq > r.os)) { r.og = p.gen; r.os = p.seq; r.epoch++; return { status: 'claimed', epoch: r.epoch } }
      return { status: 'superseded' }
    }
    case 'save': {
      const h = identity(db, p)
      if (!h) return { status: 'unknown_host' }
      const r = db.row
      const hostOk = m.saveNoState ||
        (h.state === 'active' && leaseOk(db, h)) ||
        (h.state === 'draining' && leaseOk(db, h) && (m.drainSaveNoOwner || r.og === p.gen))
      if (!hostOk) return { status: h.state === 'active' || h.state === 'draining' ? 'host_expired' : 'host_inactive' }
      return { status: 'ok', result: p.epoch === r.epoch ? 'applied' : 'stale' }
    }
  }
  throw new Error(op)
}

// ── Procesos y escenarios ───────────────────────────────────────────────────

const proc = (name, extra = {}) => ({
  name, hostId: `h-${name}`, gen: null, phase: 'new', pending: null, epoch: null,
  lost: 0, canCrash: false, canReady: true, renews: 0, claims: 0, saves: 0, rogue: 0, reactivate: 0, learnedNewer: false, ...extra,
})

// Presupuestos por escenario (lo justo para que cada regla quede ejercitada y la exploración termine).
const SCENARIOS = {
  'S1 candidato falla antes de estar listo': { P: { renews: 1 }, others: [proc('C1', { canCrash: true, canReady: false, renews: 1 })] },
  'S2 candidato lento': { P: { renews: 1 }, others: [proc('C1', { renews: 1 })] },
  'S3 dos candidatos concurrentes': { P: { renews: 1 }, others: [proc('C1'), proc('C2')] },
  'S4 respuesta perdida en acquire/activate': { P: {}, others: [proc('C1', { lost: 2 })] },
  'S5 reactivar draining/stopped': { P: { renews: 1, saves: 1, reactivate: 1, rogue: 1 }, others: [proc('C1')] },
  'S6 claims y guardados hostiles por estado': { P: { claims: 1 }, others: [proc('C1', { rogue: 1 })] },
  'S7 guardado hostil de un host draining sin la fila': { P: { renews: 1, rogue: 1 }, others: [proc('C1', { claims: 1 })] },
}

function initial(scenarioName) {
  const sc = SCENARIOS[scenarioName]
  const P = proc('P', { gen: 1, phase: 'active', epoch: 1, ...sc.P })
  return {
    db: { now: 0, nextGen: 1, hosts: { 1: { gen: 1, hostId: 'h-P', state: 'active', lease: L, ready: true } }, row: { og: 1, os: 1, epoch: 1 } },
    procs: [P, ...structuredClone(sc.others)],
    reqs: [], nextReq: 1, firstGen: { 'h-P': 1 }, violations: [], activatedHigher: false,
  }
}

function actions(st) {
  const out = []
  if (st.db.now < MAX_NOW) out.push({ t: 'tick' })
  st.procs.forEach((p, i) => {
    if (p.phase === 'crashed' || p.pending !== null) return
    const send = (op, extra = {}) => out.push({ t: 'send', i, op, extra })
    if (p.phase === 'new') send('acquire')
    if (p.phase === 'starting') {
      if (p.canReady) out.push({ t: 'ready', i })
      if (p.renews > 0) send('renew')
      if (p.canCrash) out.push({ t: 'crash', i })
      if (p.rogue > 0) { send('claim', { rogue: true }); send('save', { rogue: true }) }
    }
    if (p.phase === 'ready') { send('activate'); if (p.canCrash) out.push({ t: 'crash', i }) }
    if (p.phase === 'active') {
      if (p.learnedNewer) send('drain')
      if (p.renews > 0) send('renew')
      if (p.claims > 0) send('claim')
      if (p.saves > 0 && p.epoch !== null) send('save')
    }
    if (p.phase === 'stopping') send('stop')
    if (p.phase === 'draining') {
      if (p.saves > 0 && p.epoch !== null) send('save')
      send('stop')
      if (p.reactivate > 0) send('activate', { rogue: true })
      if (p.rogue > 0) send('save', { rogue: true })
    }
    if (p.phase === 'stopped') {
      if (p.reactivate > 0) { send('activate', { rogue: true }); send('renew', { rogue: true }) }
      if (p.rogue > 0) send('save', { rogue: true })
    }
  })
  for (const r of st.reqs) {
    if (!r.applied) out.push({ t: 'db', id: r.id })
    const p = st.procs[r.i]
    if (r.applied && !r.done && p.pending === r.id && p.phase !== 'crashed') {
      out.push({ t: 'deliver', id: r.id })
      if (p.lost > 0 && (r.op === 'acquire' || r.op === 'activate')) out.push({ t: 'lose', id: r.id })
    }
  }
  return out
}

function step(state, a, m) {
  const st = structuredClone(state)
  const v = msg => st.violations.push(msg)
  if (a.t === 'tick') { st.db.now++; return st }
  if (a.t === 'ready') { st.procs[a.i].phase = 'ready'; return st }
  if (a.t === 'crash') { st.procs[a.i].phase = 'crashed'; st.procs[a.i].pending = null; return st }
  if (a.t === 'send') {
    const p = st.procs[a.i]
    if (a.op === 'renew' && !a.extra.rogue) p.renews--
    if (a.op === 'claim' && !a.extra.rogue) p.claims--
    if (a.op === 'save' && !a.extra.rogue) p.saves--
    if (a.extra.rogue) { if (a.op === 'activate' || a.op === 'renew') p.reactivate = 0; else p.rogue = 0 }
    const payload = { hostId: p.hostId, gen: p.gen, seq: 2, epoch: a.extra.rogue && a.op === 'save' ? st.db.row.epoch : p.epoch }
    const r = { id: st.nextReq++, i: a.i, op: a.op, payload, rogue: Boolean(a.extra.rogue), applied: false, done: false, answer: null }
    st.reqs.push(r)
    if (!r.rogue) p.pending = r.id
    return st
  }
  if (a.t === 'db') {
    const r = st.reqs.find(x => x.id === a.id)
    const before = structuredClone(st.db)
    r.answer = applyOp(st.db, r.op, r.payload, m)
    r.applied = true
    // H2: monotonía de estados
    for (const [gen, h] of Object.entries(before.hosts)) if (RANK[st.db.hosts[gen].state] < RANK[h.state]) v(`H2: host ${gen} ${h.state} → ${st.db.hosts[gen].state}`)
    // H3: una generación por hostId; acquire no cambia el estado de un host existente
    if (r.op === 'acquire') {
      const first = st.firstGen[r.payload.hostId]
      if (first === undefined) st.firstGen[r.payload.hostId] = r.answer.gen
      else if (first !== r.answer.gen) v(`H3: ${r.payload.hostId} recibió la generación ${r.answer.gen} (antes ${first})`)
      for (const [gen, h] of Object.entries(before.hosts)) if (st.db.hosts[gen].state !== h.state) v('H3: acquire cambió el estado de un host existente')
    }
    // H5: activación válida
    if (r.op === 'activate' && r.answer.status === 'active') {
      const h = before.hosts[r.payload.gen]
      if (h && h.state !== 'active' && !(h.state === 'starting' && h.lease > before.now && !higherActive(before, h.gen))) v(`H5: activación de ${r.payload.gen} desde ${h.state} (lease ${h.lease}, now ${before.now})`)
    }
    // H1: newerActive solo con un host más nuevo realmente activo y listo
    if (r.op === 'renew' && r.answer.newerActive) {
      const ok = Object.values(before.hosts).some(h => h.gen > r.payload.gen && h.state === 'active' && h.ready && h.lease > before.now)
      if (!ok) v(`H1: ${r.payload.gen} recibió newerActive sin un host más nuevo activo y listo`)
    }
    // H4: claims y guardados según estado
    const h = before.hosts[r.payload.gen]
    if (r.op === 'claim' && r.answer.status === 'claimed' && !(h && h.state === 'active' && h.lease > before.now)) v(`H4: claim aplicado desde ${h?.state} (lease ${h?.lease}, now ${before.now})`)
    if (r.op === 'save' && r.answer.result === 'applied') {
      const okState = h && h.lease > before.now && (h.state === 'active' || (h.state === 'draining' && before.row.og === r.payload.gen))
      if (!okState) v(`H4: guardado aplicado desde ${h?.state} (lease ${h?.lease}, now ${before.now}, dueño g${before.row.og})`)
    }
    return st
  }
  if (a.t === 'lose' || a.t === 'deliver') {
    const r = st.reqs.find(x => x.id === a.id)
    const p = st.procs[r.i]
    r.done = true
    p.pending = null
    if (a.t === 'lose') {
      // La respuesta se perdió: el proceso reintenta la misma operación.
      p.lost--
      const again = { ...r, id: st.nextReq++, applied: false, done: false, answer: null }
      st.reqs.push(again); p.pending = again.id
      return st
    }
    const ans = r.answer
    if (r.op === 'acquire') {
      if (p.gen !== null && p.gen !== ans.gen) v(`H3: reintento de acquire devolvió g${ans.gen} (tenía g${p.gen})`)
      p.gen = ans.gen; p.phase = 'starting'
    } else if (r.op === 'activate') {
      p.phase = ans.status === 'active' ? 'active' : 'stopping'
    } else if (r.op === 'renew') {
      if (ans.newerActive || ans.status === 'host_inactive' || (ans.status === 'host_expired' && p.phase !== 'starting')) p.learnedNewer = true
      if (p.phase === 'starting' && ans.status !== 'ok') p.phase = 'stopping'
    } else if (r.op === 'drain') {
      p.phase = 'draining'
    } else if (r.op === 'stop') {
      p.phase = 'stopped'
    } else if (r.op === 'claim' && ans.status === 'claimed') {
      p.epoch = ans.epoch
    }
    return st
  }
  throw new Error(a.t)
}

function finalChecks(st) {
  const out = []
  for (const p of st.procs) {
    const h = st.db.hosts[p.gen]
    if (p.learnedNewer && p.phase !== 'crashed' && h && (h.state === 'active')) out.push(`H6: ${p.name} supo de uno más nuevo y sigue active`)
  }
  for (const p of st.procs) {
    if (p.canCrash && !p.canReady) {
      if (Object.values(st.db.hosts).some(h => h.hostId === p.hostId && h.state === 'active')) out.push(`H7: ${p.name} (caído antes de estar listo) quedó active`)
      if (!Object.values(st.db.hosts).some(h => h.gen > 1 && h.ready) && st.db.hosts[1].state !== 'active') out.push('H7: el vigente dejó de estar activo sin un sucesor listo')
    }
  }
  return out
}

function explore(scenarioName, m) {
  const seen = new Set()
  const res = { states: 0, terminals: 0, violations: {}, example: null }
  const visit = (st, trail) => {
    const open = st.reqs.filter(r => !r.applied || (!r.done && st.procs[r.i].pending === r.id))
    const key = JSON.stringify([st.db, st.procs, open, st.violations, st.firstGen])
    if (seen.has(key)) return
    seen.add(key)
    const next = actions(st)
    if (next.length === 0) {
      res.terminals++
      const all = [...st.violations, ...finalChecks(st)]
      for (const x of all) res.violations[x.slice(0, 2)] = (res.violations[x.slice(0, 2)] ?? 0) + 1
      if (all.length && (!res.example || trail.length < res.example.length)) res.example = [...trail, `⇒ ${all[0]}`]
      return
    }
    for (const a of next) visit(step(st, a, m), [...trail, label(st, a)])
  }
  visit(initial(scenarioName), [])
  res.states = seen.size
  return res
}

function label(st, a) {
  if (a.t === 'tick') return `tick (now=${st.db.now + 1})`
  if (a.t === 'ready' || a.t === 'crash') return `${st.procs[a.i].name} ${a.t === 'ready' ? 'queda listo' : 'se cae'}`
  if (a.t === 'send') return `${st.procs[a.i].name} envía ${a.op}${a.extra.rogue ? ' (hostil)' : ''}`
  const r = st.reqs.find(x => x.id === a.id)
  if (a.t === 'db') return `base aplica ${st.procs[r.i].name}.${r.op}`
  return `${st.procs[r.i].name} ${a.t === 'lose' ? 'pierde' : 'recibe'} la respuesta de ${r.op}`
}

// ── Ejecución ────────────────────────────────────────────────────────────────

const verbose = process.argv.includes('--trazas')
const rows = []
let failed = false
for (const [mutant, m] of Object.entries(MUTANTS)) {
  const row = { variante: mutant }
  let detected = false
  for (const scenario of Object.keys(SCENARIOS)) {
    const r = explore(scenario, m)
    const kinds = Object.keys(r.violations).sort().join(',')
    row[scenario.slice(0, 2)] = kinds || '0'
    if (kinds) detected = true
    if (verbose && r.example && mutant !== 'propuesta') console.log(`\n${mutant} · ${scenario} · contraejemplo más corto:\n  ${r.example.join('\n  ')}`)
    if (mutant === 'propuesta' && kinds) { failed = true; console.log(`\nPROPUESTA VIOLA ${kinds} en ${scenario}:\n  ${r.example.join('\n  ')}`) }
    if (mutant === 'propuesta') row[`${scenario.slice(0, 2)} estados`] = r.states
  }
  row.resultado = mutant === 'propuesta' ? (detected ? 'FALLA' : 'OK (0 violaciones)') : detected ? 'detectado' : 'NO detectado'
  rows.push(row)
}
console.table(rows)
if (failed) process.exitCode = 1
