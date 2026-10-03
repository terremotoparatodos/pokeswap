import { startRealtimeServer } from './realtimeServer.js'

// The process entry point. Everything (room, shutdown hooks, WORLD LOCATION-4 host
// lifecycle, health port) lives in realtimeServer.js, so tests can start it in-process.
await startRealtimeServer()
