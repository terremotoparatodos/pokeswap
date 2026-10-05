import { loadCloudEnvironment } from './cloudEnvironment.js'

// The process entry point. Everything (room, shutdown hooks, WORLD LOCATION-4 host
// lifecycle, health port) lives in realtimeServer.js, so tests can start it in-process.
// CLOUD ENV-1: the realtime's modules read the environment when they are imported, so on
// Colyseus Cloud its files are loaded first and the realtime is imported only afterwards
// (a dynamic import: a static one would be evaluated before this line).
await loadCloudEnvironment()
const { startRealtimeServer } = await import('./realtimeServer.js')
await startRealtimeServer()
