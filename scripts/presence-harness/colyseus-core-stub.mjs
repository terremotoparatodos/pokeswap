// LOCAL VERIFICATION ONLY — minimal @colyseus/core surface used by PresenceRoom tests.
export class Room { setSimulationInterval() {} onMessage() {} }
export class ServerError extends Error { constructor(code, message) { super(message); this.code = code } }
export class Server {}
