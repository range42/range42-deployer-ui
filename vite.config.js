import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    // HMR: use the actual VM IP so remote browsers can connect
    hmr: {
      host: '192.168.42.123',
    },
    // Proxy API requests so the browser only needs to reach the UI VM
    proxy: {
      '/v0': {
        target: 'http://192.168.42.121:8000',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://192.168.42.121:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://192.168.42.121:8000',
        ws: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
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
})
