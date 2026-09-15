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
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
}
