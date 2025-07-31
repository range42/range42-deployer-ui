import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './index.css'

const app = createApp(App)

// Global error handler to prevent recursive updates
app.config.errorHandler = (err, vm, info) => {
  // Check if this is a recursive update error
  if (err.message && err.message.includes('Maximum recursive updates exceeded')) {
    console.warn('Recursive update detected, preventing infinite loop:', err.message)
    return false
  }

  console.error('Vue Error:', err)
  console.error('Component:', vm)
  console.error('Info:', info)

  // Prevent the error from propagating to avoid recursive updates
  return false
}

// Global warn handler
app.config.warnHandler = (msg, vm, trace) => {
  // Only log warnings in development
  if (import.meta.env.DEV) {
    console.warn('Vue Warning:', msg)
    console.warn('Component:', vm)
    console.warn('Trace:', trace)
  }
}

app.use(router)

app.mount('#app')
