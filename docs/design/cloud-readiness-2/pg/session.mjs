// CLOUD READINESS-2 — one independent Postgres connection = one `psql` inside a LOCAL Supabase db
// container (`docker exec -i <container> psql -U postgres -d <database>`). Same technique as
// scripts/world-location/postgres-concurrency/pgSession.mjs, with the database as a parameter so
// the validation runs in its own database and never touches the stack's `postgres` database.
//
// Each command is followed by an `\echo` marker; a command blocked on a lock simply has no marker
// yet, and other connections observe the wait in pg_stat_activity. No npm dependency.

import { spawn } from 'node:child_process'

const BS = String.fromCharCode(92)
const NL = '\n'
let markers = 0

export class PgSession {
  constructor(container, database, name) {
    this.name = name
    this.pid = null
    this.buffer = ''
    this.waiters = []
    this.exited = false
    this.proc = spawn('docker', ['exec', '-i', container, 'sh', '-c',
      `exec psql -U postgres -d ${database} -X -q -A -t -v ON_ERROR_STOP=0 2>&1`], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', chunk => { this.buffer += chunk; this.#deliver() })
    this.proc.stderr.on('data', chunk => { this.buffer += chunk.toString(); this.#deliver() })
    this.proc.stdin.on('error', () => {})
    this.closed = new Promise(resolve => this.proc.on('exit', () => {
      this.exited = true
      for (const w of this.waiters.splice(0)) w.resolve({ ok: false, errors: [`connection ${this.name} closed`], rows: [], closed: true })
      resolve()
    }))
  }

  #deliver() {
    for (;;) {
      const waiter = this.waiters[0]
      if (!waiter) return
      const at = this.buffer.indexOf(waiter.marker)
      if (at < 0) return
      const text = this.buffer.slice(0, at)
      this.buffer = this.buffer.slice(at + waiter.marker.length).replace(/^\r?\n/, '')
      this.waiters.shift()
      const lines = text.split(/\r?\n/).filter(line => line.length)
      const errors = lines.filter(line => /(?:ERROR|FATAL):/.test(line))
      const rows = lines.filter(line => !/(?:ERROR|FATAL|NOTICE|WARNING|DETAIL|HINT|CONTEXT|LINE \d+):|^\s*\^|^psql:/.test(line))
      waiter.resolve({ ok: errors.length === 0, errors, rows })
    }
  }

  /** Sends one SQL command (ending in `;`). Resolves { ok, errors, rows } once it finished. */
  send(sql) {
    if (this.exited) return Promise.resolve({ ok: false, errors: [`connection ${this.name} closed`], rows: [], closed: true })
    const marker = `@@cr2-${++markers}@@`
    const answer = new Promise(resolve => this.waiters.push({ marker, resolve }))
    this.proc.stdin.write(sql + NL + BS + 'echo ' + marker + NL)
    return answer
  }

  async one(sql) {
    const r = await this.send(sql)
    if (!r.ok) throw new Error(`[${this.name}] ${sql.slice(0, 120)} → ${r.errors.join(' | ')}`)
    return r.rows.length ? r.rows[0] : null
  }

  async json(sql) {
    const value = await this.one(sql)
    return value == null ? null : JSON.parse(value)
  }

  async init(role = null) {
    this.pid = Number(await withDeadline(this.one('SELECT pg_backend_pid();'), 15_000, `connect ${this.name}`))
    if (role) await this.one(`SET ROLE ${role};`)
    return this
  }

  async close() {
    if (this.exited) return
    try { this.proc.stdin.end(BS + 'q' + NL) } catch {}
    const done = await Promise.race([this.closed.then(() => true), sleep(3_000).then(() => false)])
    if (!done) { this.proc.kill(); await Promise.race([this.closed, sleep(3_000)]) }
  }
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function withDeadline(promise, ms, what) {
  let timer
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no answer after ${ms} ms`)), ms) })
  try { return await Promise.race([promise, deadline]) } finally { clearTimeout(timer) }
}
