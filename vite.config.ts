import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * Short commit of this build, so a bug report can name the build it came from.
 * A checkout without git (or without history) still builds: it reports
 * `unknown` rather than failing.
 */
function buildCommit(): string {
  if (process.env.VITE_BUILD_ID) return process.env.VITE_BUILD_ID
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  envDir: '..',
  plugins: [vue()],
  define: {
    __PLAYTEST_COMMIT__: JSON.stringify(buildCommit()),
    __PLAYTEST_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
  },
})
