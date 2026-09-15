import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

// vite.config.js exports a callback (({ mode }) => config); resolve it for test mode
// before merging, since mergeConfig cannot merge a config in callback form.
const resolvedViteConfig =
  typeof viteConfig === 'function'
    ? viteConfig({ mode: 'test', command: 'serve' })
    : viteConfig

export default mergeConfig(
  resolvedViteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // The compiler contract uses node:test and runs through test:typecheck.
      exclude: [...configDefaults.exclude, 'e2e/**', 'tools/typecheck-contract.test.mjs'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      setupFiles: ['./src/__tests__/setup.js'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{js,ts,vue}'],
        exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
      },
    },
  }),
)
