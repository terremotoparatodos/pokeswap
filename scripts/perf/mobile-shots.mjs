// MOBILE-1: phone-viewport screenshots and how much of the screen the UI covers.
//   node scripts/perf/mobile-shots.mjs --url "<page>" --out <dir> --label <name> [--wait 7000] [--eval "<js before shot, its value is printed>"]
// Emulates an iPhone 15 Pro (touch, coarse pointer, dpr 3) in two viewports:
//   safari     393×659  portrait Safari with its toolbars shown
//   standalone 393×852  home-screen web app (no browser chrome)
//   landscape  852×353  landscape Safari
// "UI coverage" is the share of the viewport painted by anything other than
// the game canvas: every visible element that paints a background, border,
// text, image or control, unioned on a 2 px grid. It is a direction, not a
// pixel-exact figure (a translucent panel counts as fully covering).
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const one = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const url = one('url'); const out = one('out'); const label = one('label', 'shot')
const wait = Number(one('wait', '7000')); const before = one('eval', null)
if (!url || !out) throw new Error('usage: --url <page> --out <dir> [--label name]')
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const VIEWPORTS = [{ name: 'safari', width: 393, height: 659 }, { name: 'standalone', width: 393, height: 852 }, { name: 'landscape', width: 852, height: 353 }]
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const port = 9333 + Math.floor(Math.random() * 500)
const profile = resolve('node_modules/.cache/perf-chrome', `mobile-${port}`)
const browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function http(path) {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${port}${path}`); if (r.ok) return r.json() } catch { /* starting */ } await sleep(200) }
  throw new Error('DevTools did not answer')
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map()
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  const send = (method, params = {}) => { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise(r => pending.set(n, r)) }
  return new Promise((ok, fail) => { ws.addEventListener('open', () => ok({ send, close: () => ws.close() })); ws.addEventListener('error', fail) })
}

// Runs in the page: union of painted non-canvas boxes over a 2 px grid.
const COVERAGE = `(() => {
  const W = innerWidth, H = innerHeight, S = 2, cols = Math.ceil(W / S), rows = Math.ceil(H / S)
  const grid = new Uint8Array(cols * rows)
  const alpha = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return c === 'transparent' ? 0 : 1; const p = m[1].split(','); return p.length > 3 ? Number(p[3]) : 1 }
  const paints = (el, cs) => {
    if (['CANVAS', 'IMG', 'SVG', 'svg', 'INPUT', 'SELECT', 'BUTTON', 'TEXTAREA', 'VIDEO'].includes(el.tagName)) return el.tagName !== 'CANVAS' || !el.classList.contains('wl-canvas')
    if (alpha(cs.backgroundColor) > 0.05 || cs.backgroundImage !== 'none') return true
    if (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) > 0 && alpha(cs.borderTopColor) > 0.05) return true
    return [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
  }
  const visible = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false } return true }
  const boxes = []
  for (const el of document.body.querySelectorAll('*')) {
    if (el.classList?.contains('wl-canvas')) continue
    const cs = getComputedStyle(el)
    if (!paints(el, cs) || !visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) continue
    // The game stage and page backgrounds are not HUD; a dialog scrim is.
    if (el.classList.contains('wl') || el.id === 'app') continue
    if (r.width * r.height >= 0.85 * W * H && !el.closest('[role=dialog],dialog,[aria-modal=true]')) continue
    boxes.push({ el, r })
    const x0 = Math.max(0, Math.floor(r.left / S)), x1 = Math.min(cols, Math.ceil(r.right / S))
    const y0 = Math.max(0, Math.floor(r.top / S)), y1 = Math.min(rows, Math.ceil(r.bottom / S))
    for (let y = y0; y < y1; y++) grid.fill(1, y * cols + x0, y * cols + x1)
  }
  let covered = 0; for (const v of grid) covered += v
  // Largest contributors by their own area, to say what is taking the space.
  const owner = el => el.closest('aside,section,nav,header,footer,[class]')
  const byOwner = new Map()
  for (const { el, r } of boxes) { const o = owner(el); const key = o ? (o.tagName.toLowerCase() + '.' + [...o.classList].slice(0, 2).join('.')) : el.tagName
    const a = Math.min(W, r.right) - Math.max(0, r.left); const b = Math.min(H, r.bottom) - Math.max(0, r.top)
    byOwner.set(key, Math.max(byOwner.get(key) ?? 0, a * b)) }
  const top = [...byOwner].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, a]) => [k, Math.round(a / (W * H) * 1000) / 10])
  const page = { inner: [W, H], visual: visualViewport ? [visualViewport.width, visualViewport.height] : null,
    stage: (() => { const s = document.querySelector('.wl'); return s ? [s.clientWidth, s.clientHeight] : null })() }
  return { uiPercent: Math.round(covered / grid.length * 1000) / 10, top, page }
})()`

try {
  mkdirSync(out, { recursive: true })
  const version = await http('/json/version')
  const root = await connect(version.webSocketDebuggerUrl)
  const results = []
  for (const vp of VIEWPORTS) {
    const { result } = await root.send('Target.createTarget', { url: 'about:blank', newWindow: true })
    let target = null
    for (let i = 0; i < 50 && !target; i++) { target = (await http('/json/list')).find(t => t.id === result.targetId); if (!target) await sleep(100) }
    const page = await connect(target.webSocketDebuggerUrl)
    await page.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 3, mobile: true })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await page.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' })
    await page.send('Page.enable')
    await page.send('Page.navigate', { url })
    await sleep(wait)
    const evaluated = before ? (await page.send('Runtime.evaluate', { expression: before, awaitPromise: true, returnByValue: true })).result?.result?.value : undefined
    if (before) await sleep(800)
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    const file = join(out, `${label}-${vp.name}.png`)
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    const measured = (await page.send('Runtime.evaluate', { expression: COVERAGE, returnByValue: true })).result.result.value
    results.push({ label, viewport: vp.name, size: `${vp.width}x${vp.height}`, file, ...(evaluated !== undefined ? { evaluated } : {}), ...measured })
    page.close()
  }
  writeFileSync(join(out, `${label}.json`), JSON.stringify(results, null, 2))
  for (const r of results) console.log(`[mobile] ${r.label} ${r.viewport} ${r.size}: UI ${r.uiPercent}% · ${r.top.map(([k, a]) => `${k} ${a}%`).join(' · ')}${r.evaluated !== undefined ? ` · eval ${JSON.stringify(r.evaluated)}` : ''}`)
} finally {
  browser.kill()
  await new Promise(done => { if (browser.exitCode !== null) done(); else browser.once('exit', done) })
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
