import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  envDir: '..',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      // The Rancho is its own page: it never loads the PokeSwap app, router or backend.
      input: {
        main: fileURLToPath(new URL('./src/index.html', import.meta.url)),
        rancho: fileURLToPath(new URL('./src/rancho/index.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
  },
})
