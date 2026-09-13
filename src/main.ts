import { createApp } from 'vue'
import router from './app/router'
import { bootstrap } from './app/bootstrap'
import App from './app/App.vue'

bootstrap()
createApp(App).use(router).mount('#app')
