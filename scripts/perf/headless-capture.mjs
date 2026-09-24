// PERF-1 headless capture: drives the measurement build in a throwaway Chrome
// profile through the DevTools protocol (Node's built-in WebSocket, no deps).
//
//   node scripts/perf/headless-capture.mjs --out <file.json> --label <name>
//     --page "<url>|<scenario or 'observe'>" [--page ...] [--duration 60]
//
// Every page is one client. A page with a scenario runs it; 'observe' records
// for --duration seconds (or until the scripted pages finish). The first
// scripted page decides when the capture ends. Headless has no real display:
// frame pacing here is synthetic; remote, sprite, chunk and load metrics are not.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const all = name => args.flatMap((v, i) => (v === `--${name}` ? [args[i + 1]] : []))
const one = (name, fallback) => all(name)[0] ?? fallback
const chrome = one('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const out = one('out')
const label = one('label', 'headless')
const duration = Number(one('duration', '60'))
const pages = all('page').map(spec => { const [url, mode] = spec.split('|'); return { url, mode: mode ?? 'observe' } })
if (!out || pages.length === 0) throw new Error('usage: --out file --page "url|scenario" [...]')

const port = 9333 + Math.floor(Math.random() * 500)
const profile = resolve('node_modules/.cache/perf-chrome', String(port))
const browser = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,720',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function http(path, method = 'GET') {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method }); if (r.ok) return r.json() } catch { /* not up yet */ }
    await sleep(200)
  }
  throw new Error(`DevTools did not answer ${path}`)
}

class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id) }
      if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails?.exception?.description?.slice(0, 300) ?? 'exception')
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') this.errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    })
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise(r => this.pending.set(id, r)) }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
    return r.result?.result?.value
  }
}

async function open(url) {
  const target = await http(`/json/new?${encodeURIComponent(url)}`, 'PUT')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, fail) => { ws.addEventListener('open', ok); ws.addEventListener('error', fail) })
  const page = new Page(ws)
  await page.send('Runtime.enable')
  return page
}

try {
  console.log('[perf] devtools', (await http('/json/version')).Browser)
  const clients = []
  for (const spec of pages) {
    const page = await open(spec.url)
    for (let i = 0; i < 100 && !(await page.eval('Boolean(window.__pokeswapPerf)').catch(() => false)); i++) await sleep(200)
    console.log('[perf] page ready', spec.url, await page.eval('Boolean(window.__pokeswapPerf)').catch(e => String(e)))
    clients.push({ ...spec, page })
  }
  // --watch <js>: print an expression from the first page every 2 s (debugging a setup).
  const watch = one('watch')
  if (watch) for (let i = 0; i < Number(one('watch-count', '8')); i++) { console.log('[perf] watch', await clients[0].page.eval(watch).catch(e => String(e))); await sleep(2000) }
  // Let every client join, receive its snapshot and warm its sheets before measuring.
  await sleep(3000)
  for (const c of clients) {
    const scenario = c.mode === 'observe' ? 'null' : JSON.stringify(c.mode)
    await c.page.eval(`window.__pokeswapPerf.session.start(${JSON.stringify(`${label}-${c.mode}`)}, ${scenario})`)
  }
  const started = Date.now()
  const scripted = clients.filter(c => c.mode !== 'observe')
  while (Date.now() - started < (scripted.length ? 600_000 : duration * 1000)) {
    await sleep(1000)
    if (scripted.length && Math.round((Date.now() - started) / 1000) % 15 === 0) {
      const progress = await scripted[0].page.eval('JSON.stringify({ at: [window.__pokeswapPerf.game.player.tx, window.__pokeswapPerf.game.player.ty], area: window.__pokeswapPerf.game.area.id, last: window.__pokeswapPerf.session.driver?.events.slice(-2) })')
      console.log('[perf] progress', progress)
    }
    if (scripted.length) {
      const done = await Promise.all(scripted.map(c => c.page.eval('!window.__pokeswapPerf.session.isRecording')))
      if (done.every(Boolean)) break
    }
  }
  const captures = []
  for (const c of clients) {
    await c.page.eval('window.__pokeswapPerf.session.stop()')
    const capture = await c.page.eval('window.__pokeswapPerf.session.export({ runner: "headless-chrome" })')
    captures.push({ url: c.url, mode: c.mode, pageErrors: c.page.errors.slice(0, 20), ...capture })
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ tool: 'pokeswap-perf-headless-v1', label, capturedAt: new Date().toISOString(), captures }, null, 2))
  console.log(`[perf] wrote ${out} (${captures.length} clients, ${Math.round((Date.now() - started) / 1000)} s)`)
} finally {
  browser.kill()
}
