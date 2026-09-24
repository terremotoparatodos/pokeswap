// Turns PERF-1 capture files into markdown tables, one row per client.
//   node scripts/perf/summarize.mjs <file-or-dir> [...]
// Accepts single captures (pokeswap-perf-v1) and headless runs (pokeswap-perf-headless-v1).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const inputs = process.argv.slice(2).flatMap(path => statSync(path).isDirectory()
  ? readdirSync(path).filter(f => f.endsWith('.json')).map(f => join(path, f)) : [path])

const rows = []
for (const file of inputs) {
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const captures = doc.tool === 'pokeswap-perf-headless-v1' ? doc.captures : doc.tool === 'pokeswap-perf-v1' ? [doc] : []
  for (const c of captures) rows.push({ file: basename(file, '.json'), c })
}

const f = v => (v === undefined || v === null ? '—' : typeof v === 'number' ? String(Math.round(v * 10) / 10) : String(v))
const table = (title, head, cells) => {
  console.log(`\n### ${title}\n`)
  console.log(`| ${head.join(' | ')} |`)
  console.log(`|${head.map(() => '---').join('|')}|`)
  for (const { file, c } of rows) console.log(`| ${[`${file} · ${c.mode ?? c.scenario ?? 'manual'}`, ...cells(c)].map(f).join(' | ')} |`)
}

table('Frame pacing', ['captura', 'Hz', 'intervalo p50', 'p95', 'p99', 'máx', 'tarde %', '>50 ms', 'jitter', 'trabajo p95', 'update p95', 'render p95', 'fuera motor p95'], c => [
  c.pacing.cadence.nominalHz ?? c.pacing.cadence.observedHz, c.pacing.intervalMs.p50, c.pacing.intervalMs.p95, c.pacing.intervalMs.p99,
  c.pacing.intervalMs.max, c.pacing.latePercent, c.pacing.over50ms, c.pacing.onTimeJitterMs, c.pacing.workMs.p95, c.pacing.updateMs.p95,
  c.pacing.renderMs.p95, c.pacing.outsideEngineMs.p95,
])
table('Hilo principal, UI y memoria', ['captura', 'long tasks', 'LoAF', 'LoAF bloqueo p95', 'HUD flush p50', 'HUD p95', 'HUD máx', 'heap inicio', 'heap fin', 'heap máx'], c => [
  c.mainThread.longTasks.count, c.mainThread.longAnimationFrames.count, c.mainThread.longAnimationFrames.blockingMs.p95,
  c.ui.hudFlushMs.p50, c.ui.hudFlushMs.p95, c.ui.hudFlushMs.max, c.mainThread.heapMb.first, c.mainThread.heapMb.last, c.mainThread.heapMb.max,
])
table('Movimiento local / cámara', ['captura', 'frames en mov.', 'paso 0/1/2/3/4+ px', 'quietos', 'despareja %', 'error redondeo p99', 'saltos cámara'], c => [
  c.motion.movingFrames, c.motion.cameraStepPx.join('/'), c.motion.stalledFrames, c.motion.unevenPercent, c.motion.roundingErrorPx.p99, c.motion.cameraJumps,
])
table('Remotos: red y ciclo de vida', ['captura', 'máx remotos', 'updates', 'intervalo p50', 'p95', '1/2/3+ casillas', 'gaps seq', 'creados', 'destruidos', 'recreados', 'flap <2 s'], c => [
  c.remote.lifecycle.maxConcurrent, c.remote.receive.updates, c.remote.receive.intervalMs.p50, c.remote.receive.intervalMs.p95,
  `${c.remote.receive.tileDistance.one}/${c.remote.receive.tileDistance.two}/${c.remote.receive.tileDistance.threeOrMore}`,
  c.remote.receive.sequenceGaps, c.remote.lifecycle.created, c.remote.lifecycle.destroyed, c.remote.lifecycle.recreated, c.remote.lifecycle.recreatedWithin2s,
])
table('Remotos: sprites y movimiento visible', ['captura', 'fallback→hoja', 'latencia hoja p95', 'hoja→fallback', 'fallback trabado (frames)', 'sin arte', 'dibujados', 'fuera pantalla', 'saltos', 'salto máx', 'esperas', 'espera p95'], c => [
  c.remote.sprites.fallbackToSheet, c.remote.sprites.fallbackToSheetMs.p95, c.remote.sprites.sheetToFallback, c.remote.sprites.stuckFallbackFrames,
  c.remote.sprites.noArt, c.remote.sprites.drawn, c.remote.sprites.culled, c.remote.motion.snaps, c.remote.motion.maxSnapTiles,
  c.remote.motion.stopAndGo, c.remote.motion.stopAndGoMs.p95,
])
table('Chunks y entidades', ['captura', 'rIC', 'builds frame/prefetch/warm', 'build frame p95', 'build prefetch máx', 'overruns idle', 'frames con build', 'evict', 'release', 'población p95', 'drawables p95'], c => [
  c.chunks.requestIdleCallback, `${c.chunks.builds.frame}/${c.chunks.builds.prefetch}/${c.chunks.builds.warm}`, c.chunks.buildMs.frame.p95,
  c.chunks.buildMs.prefetch.max, c.chunks.idleOverruns, c.chunks.framesWithInFrameBuild, c.chunks.evicted, c.chunks.released,
  c.entities.populace.p95, c.entities.drawables.p95,
])
