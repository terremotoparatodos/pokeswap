// CLOUD ENV-1: on Colyseus Cloud the dashboard variables arrive in `.env.cloud` and the
// platform's in `/etc/environment`; @colyseus/tools loads both (and `.env.<NODE_ENV>`, `.env`)
// as a side effect of being imported. Before this, the first import of tools happened inside
// `gameServer.listen()`, long after the realtime's modules had captured the environment at
// import time (PresenceRoom: WORLD_LOCATION_PERSISTENCE; the world adapters: NODE_ENV,
// WORLD_AUTHORITY_URL / _SECRET, …), so a Cloud process started with location off and the
// world unavailable. index.js awaits this BEFORE it imports the realtime.
//
// Outside Cloud nothing is loaded: local and dev keep exactly the environment they had.
// Precedence is @colyseus/tools' own, unchanged (it only happens earlier): `/etc/environment`
// and `.env.cloud` override variables already in the process; `.env.<NODE_ENV>` and `.env`
// never do.

/** Loads the Colyseus Cloud environment when running on Cloud; true if it did. */
export async function loadCloudEnvironment() {
  if (process.env.COLYSEUS_CLOUD === undefined) return false
  await import('@colyseus/tools')
  return true
}
