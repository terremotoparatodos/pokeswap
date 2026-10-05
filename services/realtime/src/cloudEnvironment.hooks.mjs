// CLOUD ENV-1 test fixture (not a test file, never imported by the realtime): a module resolve
// hook for child processes that run the REAL src/index.js. When index.js imports
// ./realtimeServer.js it gets cloudEnvironment.probe.js instead, which imports the same
// environment-capturing modules (PresenceRoom and its world/location adapters) at the same point
// of the module graph, reports what they captured and exits, without listening anywhere.
const PROBE = new URL('./cloudEnvironment.probe.js', import.meta.url).href
const INDEX = new URL('./index.js', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === './realtimeServer.js' && context.parentURL === INDEX) return { url: PROBE, shortCircuit: true }
  return nextResolve(specifier, context)
}
