import { createServer } from 'node:http'

export function createHealthServer({ port, metrics, ready, version = null }) {
  return createServer((request, response) => {
    const body = request.url === '/healthz' ? [200, { status: 'ok' }]
      : request.url === '/readyz' ? [ready() ? 200 : 503, { status: ready() ? 'ready' : 'not-ready' }]
        : request.url === '/metrics' ? [200, metrics.snapshot()]
          : request.url === '/version' && version ? [200, version] : [404, { error: 'not-found' }]
    response.writeHead(body[0], { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(body[1]))
  }).listen(port)
}
