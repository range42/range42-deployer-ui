import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.VITE_DEV_PORT || '3000', 10),
    hmr: process.env.VITE_HMR_HOST
      ? { host: process.env.VITE_HMR_HOST }
      : undefined,
    proxy: process.env.VITE_API_URL
      ? {
          '/v0': { target: process.env.VITE_API_URL, changeOrigin: true },
          '/ws': { target: process.env.VITE_API_URL.replace(/^http/, 'ws'), ws: true },
        }
      : undefined,
  },
  plugins: [
    vue(),
    vueJsx(),
    mode === 'development' && vueDevTools(),
    tailwindcss(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  worker: {
    format: 'es',
  },
}))
