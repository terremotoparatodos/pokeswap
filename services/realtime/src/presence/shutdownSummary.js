/**
 * WORLD LOCATION-4 (design L1): the shutdown log tells apart what the final flush wrote, what
 * the database refused because another session already owns the row, and what was never
 * written (not sent before the deadline, or refused because this host was no longer active).
 *
 * `drained` is the flush of onBeforeShutdown (before any socket closed) and `late` the one of
 * onShutdown (whatever a disconnect still marked). A row left by the first is tried again by
 * the second, so only the last pass says what stayed unsaved.
 */
export function shutdownFlushSummary(drained, late) {
  const passes = [drained, late].filter(Boolean)
  const sum = key => passes.reduce((total, pass) => total + (pass[key] ?? 0), 0)
  return {
    saved: sum('applied') + sum('duplicate'),
    refused: sum('stale'),
    unsaved: (passes.at(-1)?.left ?? 0) + sum('hostRefused'),
    timedOut: passes.some(pass => pass.timedOut),
  }
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** The log line, or null when the flush had nothing to do. */
export function shutdownFlushLine(drained, late) {
  const { saved, refused, unsaved, timedOut } = shutdownFlushSummary(drained, late)
  if (!saved && !refused && !unsaved) return null
  return `[location] shutdown flush: ${count(saved, 'guardada', 'guardadas')}, `
    + `${count(refused, 'rechazada', 'rechazadas')} (otra sesión ya reclamó), `
    + `${count(unsaved, 'sin guardar', 'sin guardar')}${timedOut ? ' (plazo vencido)' : ''}`
}
