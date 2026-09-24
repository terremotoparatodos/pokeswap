// PERF-1 capture collector: a Vite dev/preview middleware that accepts one
// JSON capture per POST and writes it under docs/performance/baselines/incoming.
// Registered only when VITE_PERF=on (vite.config.ts), so a phone on the same
// network can hand its capture to this machine without copying files around.
// Never part of a production build: Vite plugins run in the dev/preview server.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const MAX_BYTES = 8 * 1024 * 1024
const OUT_DIR = join(process.cwd(), 'docs', 'performance', 'baselines', 'incoming')

function handler(request: IncomingMessage, response: ServerResponse, next: () => void): void {
  if (request.url !== '/__perf/report') return next()
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' }); response.end(); return }
  if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
  let size = 0
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_BYTES) { response.writeHead(413); response.end(); request.destroy(); return }
    chunks.push(chunk)
  })
  request.on('end', () => {
    try {
      const capture = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tool?: string; label?: string; scenario?: string | null }
      if (capture.tool !== 'pokeswap-perf-v1') throw new Error('not a PERF-1 capture')
      const safe = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'capture'
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safe(capture.label)}-${safe(capture.scenario ?? 'manual')}.json`
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(join(OUT_DIR, name), JSON.stringify(capture, null, 2))
      response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      response.end(JSON.stringify({ saved: name }))
    } catch (error) {
      response.writeHead(400, { 'Access-Control-Allow-Origin': '*' })
      response.end(String(error instanceof Error ? error.message : error))
    }
  })
}

export function perfCollector(): Plugin {
  return {
    name: 'pokeswap-perf-collector',
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}
