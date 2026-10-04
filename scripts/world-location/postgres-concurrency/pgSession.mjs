// WORLD LOCATION-4 F2 — one independent Postgres connection = one `psql` process inside the LOCAL
// database container of a Supabase stack (`docker exec -i <container> psql -U postgres`).
//
// Each command is followed by an `\echo` marker and the output (stdout and stderr, merged inside
// the container) is read up to that marker. A command that blocks on a lock simply has no marker
// yet: the caller observes the wait from another connection (pg_stat_activity).
//
// No npm dependency: psql ships in the Supabase Postgres image.

import { spawn } from 'node:child_process'

const BS = String.fromCharCode(92) // backslash, written once (shell heredocs and template literals eat it)
const NL = '\n'
let markers = 0

export class PgSession {
  /**
   * @param {string} container  a local Supabase db container (validated by localDatabase.mjs)
   * @param {string} name       for messages only
   */
  constructor(container, name) {
    this.name = name
    this.pid = null
    this.buffer = ''
    this.waiters = []
    this.exited = false
    this.proc = spawn('docker', ['exec', '-i', container, 'sh', '-c',
      'exec psql -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=0 2>&1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', chunk => { this.buffer += chunk; this.#deliver() })
    this.proc.stderr.on('data', chunk => { this.buffer += chunk.toString(); this.#deliver() })
    this.proc.stdin.on('error', () => {}) // a closed pipe surfaces through `exit`
    this.closed = new Promise(resolve => this.proc.on('exit', () => {
      this.exited = true
      for (const w of this.waiters.splice(0)) w.resolve({ ok: false, errors: [`connection ${this.name} closed`], rows: [], closed: true })
      resolve()
    }))
    this.proc.on('error', error => { this.spawnError = error })
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
    const marker = `@@wloc-f2-${++markers}@@`
    const answer = new Promise(resolve => this.waiters.push({ marker, resolve }))
    this.proc.stdin.write(sql + NL + BS + 'echo ' + marker + NL)
    return answer
  }

  /** The first row of a command that must succeed. */
  async one(sql) {
    const r = await this.send(sql)
    if (!r.ok) throw new SqlError(`[${this.name}] ${sql.slice(0, 100)} → ${r.errors.join(' | ')}`)
    return r.rows.length ? r.rows[0] : null
  }

  async json(sql) {
    const value = await this.one(sql)
    return value == null ? null : JSON.parse(value)
  }

  /** Connects (the first round trip proves it) and optionally switches role, as PostgREST does. */
  async init(role = null, ms = 15_000) {
    const pid = await withDeadline(this.one('SELECT pg_backend_pid();'), ms, `connect ${this.name}`)
    this.pid = Number(pid)
    if (role) await this.one(`SET ROLE ${role};`)
    return this
  }

  /** Ends the session; never hangs: after `ms` the local process is killed. */
  async close(ms = 3_000) {
    if (this.exited) return
    try { this.proc.stdin.end(BS + 'q' + NL) } catch { /* the pipe is already gone */ }
    const done = await Promise.race([this.closed.then(() => true), sleep(ms).then(() => false)])
    if (!done) { this.proc.kill(); await Promise.race([this.closed, sleep(ms)]) }
  }
}

export class SqlError extends Error {}
export class DeadlineError extends Error {}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function withDeadline(promise, ms, what) {
  let timer
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new DeadlineError(`${what}: no answer after ${ms} ms`)), ms) })
  try { return await Promise.race([promise, deadline]) } finally { clearTimeout(timer) }
}
