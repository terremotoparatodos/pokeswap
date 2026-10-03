// WORLD LOCATION-4 harness — host lifecycle scenarios over real realtime processes, each on
// its own local authority (orderingHarness.mjs runs them; LOCAL ONLY).
//
//   candidates      two processes start at once: one active host remains, the older never
//                   activates after the newer, the older drains within one renewal
//   failed-startup  the authority refuses presence calls at start: the process serves without
//                   persistence (no claim, no row), then acquires and activates once it is back
//   drain           a newer host starts: the older closes every socket with 4503 (never 4001)
//                   after saving every position; players resume on the newer one, in place
//   shutdown        a graceful shutdown (SIGTERM): every socket 4503 (protocol 2 and 3), a
//                   join during the shutdown refused or closed with 4503, every position saved
//   lost            claim and save answers lost after the database applied them: the retries
//                   adopt the same epoch and answer duplicate; nothing is applied twice

import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, leave, nudge, startRealtime } from './realtimeProcesses.mjs'
import { tail } from './harnessRandom.mjs'

const waitFor = async (condition, ms) => { for (let t = 0; t < ms && !(await condition()); t += 50) await delay(50); return Boolean(await condition()) }

async function withAuthority({ tree, random }, run) {
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex'), tree, latency: () => tail(random, 20, 200) })
  const servers = []
  const start = async options => { const server = await startRealtime({ tree, ...options }); servers.push(server); return server }
  try {
    return await run(local, start)
  } finally {
    for (const server of servers) await server.kill()
    await local.close()
  }
}

const rowOf = local => async userId => (await local.query('SELECT area_id, tx, ty, epoch::int AS epoch FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0] ?? null
const place = self => self && { areaId: self.areaId, tx: self.tx, ty: self.ty }
const same = (row, at) => Boolean(row && at && row.area_id === at.areaId && row.tx === at.tx && row.ty === at.ty)
const verdict = (checks, extra = {}) => ({ applicable: true, passed: checks.every(c => c.ok), checks, ...extra })
const lifecycleOnly = async local => (await local.hosts()) !== null

async function candidates(context) {
  return withAuthority(context, async (local, start) => {
    if (!(await lifecycleOnly(local))) return { applicable: false, reason: 'this tree has no presence hosts (pre WORLD LOCATION-4)' }
    const checks = []
    for (let round = 0; round < 6; round++) {
      const port = context.basePort + round * 20
      // Rounds 0-2: both start at once. Rounds 3-5: R acquires first (older), but its activation
      // reaches the database 4 s late, after S (newer) is active: it must be refused.
      const inverted = round >= 3
      if (inverted) local.rule({ op: 'presence_activate', inst: `R${round}`, mode: 'delay', ms: 4_000 })
      const [r, s] = inverted
        ? [await start({ name: `R${round}`, port, env: local.env('on', `R${round}`) }), await start({ name: `S${round}`, port: port + 10, env: local.env('on', `S${round}`) })]
        : await Promise.all([
          start({ name: `R${round}`, port, env: local.env('on', `R${round}`) }),
          start({ name: `S${round}`, port: port + 10, env: local.env('on', `S${round}`) }),
        ])
      // One renewal (5 s) is the bound in which an older active host learns of a newer one.
      await delay(7_000)
      const hosts = (await local.hosts()).slice(-2)
      const [older, newer] = hosts
      const actives = hosts.filter(h => h.state === 'active')
      checks.push({ name: `round ${round}: exactly one active host, the newer`, ok: actives.length === 1 && actives[0].generation === newer.generation, detail: JSON.stringify(hosts.map(h => [h.generation, h.state])) })
      checks.push({ name: `round ${round}: the older never activated after the newer`, ok: !older.activated_at || !newer.activated_at || older.activated_at <= newer.activated_at, detail: JSON.stringify([older.activated_at, newer.activated_at]) })
      if (inverted) checks.push({ name: `round ${round}: a late activation of the older candidate is refused (never active)`, ok: older.activated_at === null && older.state === 'stopped', detail: JSON.stringify(older) })
      const ready = await Promise.all([r.ready(), s.ready()])
      checks.push({ name: `round ${round}: one process stays ready`, ok: ready.filter(code => code === 200).length === 1, detail: JSON.stringify(ready) })
      await r.kill(); await s.kill()
    }
    return verdict(checks)
  })
}

async function failedStartup(context) {
  return withAuthority(context, async (local, start) => {
    if (!(await lifecycleOnly(local))) return { applicable: false, reason: 'this tree has no presence hosts (pre WORLD LOCATION-4)' }
    const checks = []
    local.rule({ op: 'presence_acquire', mode: 'fail', times: Number.POSITIVE_INFINITY })
    const server = await start({ name: 'F', port: context.basePort, env: local.env('on', 'F') }) // listens after the 10 s acquire wait
    const early = await local.player()
    const socket = await connect(server, early.token, { tabId: 'tab-early-harness' })
    checks.push({ name: 'without a generation the process still serves (no persistence)', ok: Boolean(socket.self) && socket.left === null })
    await nudge(socket, openDirectionFor(context))
    await leave(socket)
    await delay(2_000)
    checks.push({ name: 'no claim and no save is ever sent without an active host', ok: !local.events.some(e => (e.op === 'location_claim' || e.op === 'location_save') && e.inst === 'F'), detail: JSON.stringify(local.calls) })
    checks.push({ name: 'no row written', ok: (await rowOf(local)(early.userId)) === null })
    local.clearRules()
    const active = await waitFor(async () => (await local.hosts()).some(h => h.state === 'active'), 90_000)
    checks.push({ name: 'once the authority is back the host acquires and activates in the background', ok: active, detail: JSON.stringify(await local.hosts()) })
    const late = await local.player()
    const after = await connect(server, late.token, { tabId: 'tab-late-harness' })
    const claimed = await waitFor(() => local.events.some(e => e.op === 'location_claim' && e.userIds.includes(late.userId) && e.answer?.claim?.status === 'claimed'), 5_000)
    checks.push({ name: 'a join after activation claims with its key', ok: claimed, detail: JSON.stringify(local.events.filter(e => e.userIds.includes(late.userId)).map(e => e.answer)) })
    await leave(after)
    await delay(1_500)
    checks.push({ name: 'the early session never claims afterwards', ok: !local.events.some(e => e.op === 'location_claim' && e.userIds.includes(early.userId)) })
    return verdict(checks)
  })
}

let openDirectionCache = null
const openDirectionFor = () => (area, self) => openDirectionCache(area, self, ['right', 'down', 'left', 'up'])
async function loadGeometry({ tree }) {
  if (!openDirectionCache) openDirectionCache = (await import(pathToFileURL(`${tree}services/realtime/src/world/testing.js`).href)).openDirection
}

async function drain(context) {
  return withAuthority(context, async (local, start) => {
    const checks = []
    const P = await start({ name: 'P', port: context.basePort, env: local.env('on', 'P') })
    const players = []
    for (let i = 0; i < 10; i++) {
      const player = await local.player()
      const socket = await connect(P, player.token, { tabId: `tab-drain-${i}-harness` })
      await nudge(socket, openDirectionFor(context))
      players.push({ ...player, socket, at: place(socket.self) })
    }
    await start({ name: 'Q', port: context.basePort + 10, env: local.env('on', 'Q') })
    const Q = { name: 'Q', port: context.basePort + 10 }
    const closed = await waitFor(() => players.every(p => p.socket.left !== null), 20_000)
    const codes = players.map(p => p.socket.left)
    checks.push({ name: 'the older host closes every socket after a newer one activates (within a renewal)', ok: closed, detail: JSON.stringify(codes) })
    checks.push({ name: 'every close is 4503 host-draining, never 4001', ok: codes.every(code => code === 4503), detail: JSON.stringify(codes) })
    checks.push({ name: 'protocol-3 clients hear presence:closing {draining} first', ok: players.every(p => p.socket.closing.includes('draining')) })
    const rows = await Promise.all(players.map(p => rowOf(local)(p.userId)))
    checks.push({ name: 'every last position was saved by the drain', ok: players.every((p, i) => same(rows[i], p.at)), detail: JSON.stringify(rows.map((r, i) => [r, players[i].at]).filter(([r, at]) => !same(r, at)).slice(0, 3)) })
    const hosts = await local.hosts()
    checks.push({ name: 'the older host is stopped (terminal), the newer active', ok: hosts !== null && hosts[0]?.state === 'stopped' && hosts.at(-1)?.state === 'active', detail: JSON.stringify(hosts?.map(h => [h.generation, h.state])) })
    const resumed = []
    for (const p of players) resumed.push(await connect(Q, p.token, { tabId: p.socket.room ? `tab-drain-${players.indexOf(p)}-harness` : null, resume: true }))
    checks.push({ name: 'players resume on the newer host exactly where they were', ok: resumed.every((s, i) => s.self && s.self.areaId === players[i].at.areaId && s.self.tx === players[i].at.tx && s.self.ty === players[i].at.ty), detail: JSON.stringify(resumed.map((s, i) => [place(s.self), players[i].at]).slice(0, 3)) })
    for (const s of resumed) await leave(s)
    return verdict(checks)
  })
}

async function shutdown(context) {
  return withAuthority(context, async (local, start) => {
    const checks = []
    const P = await start({ name: 'P', port: context.basePort, env: local.env('on', 'P') })
    const players = []
    for (let i = 0; i < 10; i++) {
      const player = await local.player()
      const presenceProtocol = i < 6 ? 3 : 2
      const socket = await connect(P, player.token, { presenceProtocol, tabId: presenceProtocol === 3 ? `tab-shut-${i}-harness` : null })
      await nudge(socket, openDirectionFor(context))
      players.push({ ...player, presenceProtocol, socket, at: place(socket.self) })
    }
    const joiner = await local.player()
    const stopping = P.shutdown()
    await delay(30)
    const during = await connect(P, joiner.token, { tabId: 'tab-joiner-harness', waitSelf: false }).catch(error => ({ refused: `error ${error?.code ?? error?.message}`, left: null }))
    const exit = await stopping
    await delay(300)
    const codes = players.map(p => p.socket.left)
    checks.push({ name: 'every connected client (protocol 2 and 3) is closed with 4503, none with 4001', ok: codes.every(code => code === 4503), detail: JSON.stringify(codes) })
    checks.push({ name: 'protocol-3 clients hear presence:closing {draining}; protocol 2 hears nothing new', ok: players.every(p => (p.presenceProtocol === 3 ? p.socket.closing.includes('draining') : p.socket.closing.length === 0)) })
    const joinOutcome = during.refused ?? during.left
    checks.push({ name: 'a join during the shutdown gets 4503 (refused or closed), never 4001', ok: joinOutcome === 4503, detail: JSON.stringify({ refused: during.refused, left: during.left }) })
    const rows = await Promise.all(players.map(p => rowOf(local)(p.userId)))
    checks.push({ name: 'every last position was saved', ok: players.every((p, i) => same(rows[i], p.at)), detail: JSON.stringify(rows.filter((r, i) => !same(r, players[i].at)).slice(0, 3)) })
    checks.push({ name: 'the process exits cleanly', ok: exit === 0, detail: String(exit) })
    checks.push({ name: 'the shutdown log counts saved, refused and unsaved rows', ok: /shutdown flush: \d+ guardadas?, \d+ rechazadas? \(otra sesión ya reclamó\), \d+ sin guardar/.test(P.log()), detail: (P.log().match(/\[location\] shutdown flush.*$/m) ?? ['(none)'])[0] })
    const hosts = await local.hosts()
    if (hosts) checks.push({ name: 'the host is stopped', ok: hosts.every(h => h.state === 'stopped'), detail: JSON.stringify(hosts.map(h => h.state)) })
    return verdict(checks)
  })
}

async function lost(context) {
  return withAuthority(context, async (local, start) => {
    if (!(await lifecycleOnly(local))) return { applicable: false, reason: 'keyed claims are WORLD LOCATION-4 only' }
    const checks = []
    const P = await start({ name: 'P', port: context.basePort, env: local.env('on', 'P') })
    const rounds = 20
    let adopted = 0
    let deduplicated = 0
    for (let i = 0; i < rounds; i++) {
      const { userId, token } = await local.player()
      local.rule({ op: 'location_claim', inst: 'P', userId, mode: 'lose' })
      const socket = await connect(P, token, { tabId: `tab-lost-${i}-harness` })
      const claims = () => local.events.filter(e => e.op === 'location_claim' && e.userIds.includes(userId))
      await waitFor(() => claims().some(e => e.rule !== 'lose' && e.tDone !== null), 8_000)
      const keys = new Set(claims().map(e => JSON.stringify([e.body?.generation, e.body?.seq, e.body?.sessionId])))
      const row = await rowOf(local)(userId)
      if (claims().length >= 2 && keys.size === 1 && row?.epoch === 1 && claims().every(e => e.answer?.claim?.epoch === 1)) adopted++
      local.rule({ op: 'location_save', inst: 'P', userId, mode: 'lose' })
      await nudge(socket, openDirectionFor(context))
      const at = place(socket.self)
      await leave(socket)
      const saves = () => local.events.filter(e => e.op === 'location_save' && e.userIds.includes(userId) && e.tDone !== null)
      await waitFor(() => saves().length >= 2, 8_000)
      const results = saves().map(e => e.answer?.save?.results ?? e.answer?.results)
      if (same(await rowOf(local)(userId), at) && saves().length >= 2 && JSON.stringify(results).includes('duplicate')) deduplicated++
    }
    checks.push({ name: `a lost claim answer: the retry carries the same key and adopts the same epoch (${adopted}/${rounds})`, ok: adopted === rounds })
    checks.push({ name: `a lost save answer: the retry answers duplicate and the row is the last position (${deduplicated}/${rounds})`, ok: deduplicated === rounds })
    return verdict(checks)
  })
}

const geometry = scenario => async context => { await loadGeometry(context); return scenario(context) }
export const LIFECYCLE = {
  candidates: geometry(candidates),
  'failed-startup': geometry(failedStartup),
  drain: geometry(drain),
  shutdown: geometry(shutdown),
  lost: geometry(lost),
}
