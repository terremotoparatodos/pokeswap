// Vite config of the dev-only ecosystem simulator (ECO-PREVIEW-1).
//
//   node node_modules/vite/bin/vite.js --config src/features/ecosystem/preview/vite.preview.config.mjs --port <free port>
//
// Loopback only, strict port (never takes over another process's port), no
// proxy, no HMR exposure beyond 127.0.0.1. `envDir` is this folder, which holds
// no .env file: the simulator reads no configuration secrets. Sprites come from
// the repo's public/ folder; nothing is downloaded.
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: here,
  envDir: here,
  publicDir: fileURLToPath(new URL('../../../../public', import.meta.url)),
  plugins: [vue()],
  clearScreen: false,
  server: { host: '127.0.0.1', strictPort: true, open: false, cors: false },
  preview: { host: '127.0.0.1', strictPort: true },
})
