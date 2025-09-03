import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './main.css'
import { i18n, ensureNamespaces } from './i18n/index.js'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

// Preload common namespace for current locale
ensureNamespaces(['common']).finally(() => {
  app.mount('#app')
})
