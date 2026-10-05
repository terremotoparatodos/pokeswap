import { createServer } from 'node:http'

/** The internal health endpoints (not listening yet). A failing handler answers 500, never throws. */
export function createHealthServer({ metrics, ready, version = null, log = () => {} }) {
  return createServer((request, response) => {
    let body
    try {
      body = request.url === '/healthz' ? [200, { status: 'ok' }]
        : request.url === '/readyz' ? [ready() ? 200 : 503, { status: ready() ? 'ready' : 'not-ready' }]
          : request.url === '/metrics' ? [200, metrics.snapshot()]
            : request.url === '/version' && version ? [200, version] : [404, { error: 'not-found' }]
    } catch (error) {
      log(`[health] request failed (${error?.name ?? 'Error'}); answering 500`)
      body = [500, { error: 'internal' }]
    }
    response.writeHead(body[0], { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(body[1]))
  })
}

/**
 * HEALTH PORT-1: listen on `port` and resolve ONCE, with 'listening' or 'unavailable'. A bind
 * failure (EADDRINUSE, EACCES, ...) or a later server error is logged with its code and never
 * thrown: observability is not allowed to end the realtime process or touch the presence host.
 *
 * The handle: { status: 'listening' | 'unavailable' | 'degraded' | 'closed', port, code, close() }.
 * 'listening' is only logged once the socket is actually bound.
 */
export function startHealthServer({ port, metrics, ready, version = null, log = () => {} }) {
  const server = createHealthServer({ metrics, ready, version, log })
  const handle = {
    status: 'starting',
    port,
    code: null,
    server,
    close() {
      if (handle.status === 'closed') return Promise.resolve()
      handle.status = 'closed'
      if (!server.listening) return Promise.resolve()
      return new Promise(resolve => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
  return new Promise(resolve => {
    // Stays attached for the life of the server: errors after startup are handled too.
    server.on('error', error => {
      handle.code = error?.code ?? 'UNKNOWN'
      if (handle.status === 'starting') {
        handle.status = 'unavailable'
        log(`[health] unavailable: could not listen on port ${port} (${handle.code}); realtime keeps serving without health endpoints`)
        resolve(handle)
      } else if (handle.status !== 'closed') {
        handle.status = 'degraded'
        log(`[health] degraded: health server error on port ${handle.port} (${handle.code}); realtime keeps serving`)
      }
    })
    server.once('listening', () => {
      if (handle.status !== 'starting') return
      handle.status = 'listening'
      handle.port = server.address().port
      log(`[health] listening on port ${handle.port}`)
      resolve(handle)
    })
    server.listen(port)
  })
}
