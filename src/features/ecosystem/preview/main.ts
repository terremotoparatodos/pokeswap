// Entry of the dev-only ecosystem simulator (ECO-PREVIEW-1). Served by its own
// Vite config (vite.preview.config.mjs) on loopback; never part of the game build.
import { createApp } from 'vue'
import EcoPreviewApp from './EcoPreviewApp.vue'

createApp(EcoPreviewApp).mount('#eco-preview')
