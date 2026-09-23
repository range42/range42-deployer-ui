import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { verifyMigratedFiles } from './check-migrated-types.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'node_modules/vue-tsc/bin/vue-tsc.js'), ...args], { cwd: root, encoding: 'utf8', timeout: 60000 })

test('the application check includes every implementation TS and Vue file', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.typecheck, 'vue-tsc --noEmit -p tsconfig.json')
  const shown = run('--showConfig', '-p', 'tsconfig.json')
  assert.equal(shown.status, 0, shown.stdout + shown.stderr)
  const config = JSON.parse(shown.stdout)
  const files = new Set(config.files.map(file => path.resolve(root, file)))
  const walk = dir => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '__tests__') continue
      const file = path.join(dir, item.name)
      if (item.isDirectory()) walk(file)
      else if (/\.(?:[cm]?tsx?|vue)$/.test(file)) assert.ok(files.has(file), `Missing implementation source: ${file}`)
    }
  }
  walk(path.join(root, 'src'))
})

test('the actual compiler rejects TS and Vue template errors while JS checking stays explicit', () => {
  const dir = mkdtempSync(path.join(root, '.typecheck-contract-'))
  try {
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: '../tsconfig.json', include: ['./*'], exclude: [] }))
    writeFileSync(path.join(dir, 'invalid.ts'), 'export const typed: number = "wrong"\n')
    writeFileSync(path.join(dir, 'Invalid.vue'), '<script setup lang="ts">const count = 1</script>\n<template>{{ count.toUpperCase() }}</template>\n')
    writeFileSync(path.join(dir, 'Legacy.vue'), '<script setup>const count = 1</script>\n<template>{{ count.toUpperCase() }}</template>\n')
    writeFileSync(path.join(dir, 'Checked.vue'), '<script setup>\n// @ts-check\nconst count = 1</script>\n<template>{{ count.toUpperCase() }}</template>\n')
    writeFileSync(path.join(dir, 'checked.js'), '// @ts-check\n/** @type {number} */\nexport const checked = "wrong"\n')
    writeFileSync(path.join(dir, 'legacy.js'), '/** @type {number} */\nexport const unchecked = "legacy"\n')
    const checked = run('--noEmit', '-p', path.join(dir, 'tsconfig.json'))
    const output = checked.stdout + checked.stderr
    assert.notEqual(checked.status, 0, 'Invalid types unexpectedly passed')
    assert.match(output, /invalid\.ts.*TS2322/)
    assert.match(output, /Invalid\.vue.*TS2339/)
    assert.match(output, /Checked\.vue.*TS2339/)
    assert.match(output, /checked\.js.*TS2322/)
    assert.doesNotMatch(output, /(?:legacy\.js|Legacy\.vue).*error TS/)
    assert.equal(JSON.parse(readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).compilerOptions.checkJs, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('migrated JavaScript sources have an enforceable annotation gate', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['typecheck:migrated'], 'node tools/check-migrated-types.mjs && npm run typecheck')
  const manifest = JSON.parse(readFileSync(path.join(root, 'typecheck-migrated.json'), 'utf8'))
  assert.ok(manifest.includes('src/stores/projectStore.js'))
  assert.ok(manifest.includes('src/components/OpenProjectFromGitModal.vue'))
  const check = spawnSync(process.execPath, ['tools/check-migrated-types.mjs'], { cwd: root, encoding: 'utf8' })
  assert.equal(check.status, 0, check.stdout + check.stderr)
})


test('the migrated-file gate refuses removed annotations and unchecked overrides', () => {
  const dir = mkdtempSync(path.join(root, '.typecheck-contract-'))
  try {
    mkdirSync(path.join(dir, 'src'))
    const file = path.join(dir, 'src/Example.vue')
    writeFileSync(file, '<script setup>const count = 1</script><template>{{ count }}</template>')
    assert.throws(() => verifyMigratedFiles(dir, ['src/Example.vue']), /Missing leading @ts-check/)
    writeFileSync(file, '<script setup>\n// @ts-check\nconst count = 1</script><template>{{ count }}</template>')
    assert.equal(verifyMigratedFiles(dir, ['src/Example.vue']), 1)
    writeFileSync(file, '<script setup>\n// @ts-check\n// @ts-nocheck\nconst count = 1</script>')
    assert.throws(() => verifyMigratedFiles(dir, ['src/Example.vue']), /Unchecked override/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
