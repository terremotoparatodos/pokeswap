module.exports = {
  apps: [
    {
      name: 'pokeswap-realtime',
      script: './src/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      // CLOUD STARTUP-1: explicit, so they hold for the Colyseus Cloud agent and for any other
      // PM2 start. PM2 only routes to the new process once it sends 'ready' (inside listen, after
      // the location acquire, which may wait ACQUIRE_WAIT_MS = 10 s); the old process drains on
      // SIGINT before PM2 escalates to SIGKILL.
      wait_ready: true,
      listen_timeout: 20000,
      kill_timeout: 30000,
    },
  ],
}
