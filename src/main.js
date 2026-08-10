import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './main.css'
import { i18n, ensureNamespaces } from './i18n/index.js'
import { loadRuntimeConfig } from './services/runtimeConfig.ts'
import { useBackendApiStore } from './stores/backendApiStore.ts'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

// Register the backend the deployment shipped in its config.json (no-op in dev,
// where no such file is served, and no-op once the operator has chosen a host).
const seedBackendFromRuntimeConfig = loadRuntimeConfig().then((config) => {
  useBackendApiStore().seedDefaultHost(config)
})

// Preload common namespace for current locale
Promise.all([ensureNamespaces(['common']), seedBackendFromRuntimeConfig]).finally(() => {
  app.mount('#app')
})
