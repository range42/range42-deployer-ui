import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

// https://vite.dev/config/
export default defineConfig({
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
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  worker: {
    format: 'es',
  },
})
