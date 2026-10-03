// WORLD LOCATION-4 harness preload (local tooling only, never loaded in production): a
// "shutdown" line on stdin delivers SIGTERM to Colyseus' own graceful-shutdown handler.
// A Windows parent cannot send a catchable SIGTERM to its child; on Linux the harness
// could signal it directly, and this path behaves the same.
import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  if (line.trim() === 'shutdown') { console.log('[harness] shutdown requested'); process.emit('SIGTERM') }
})
process.on('exit', code => console.log(`[harness] exit ${code}`))
