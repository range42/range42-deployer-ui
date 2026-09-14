import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

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
    writeFileSync(path.join(dir, 'legacy.js'), '/** @type {number} */\nexport const unchecked = "legacy"\n')
    const checked = run('--noEmit', '-p', path.join(dir, 'tsconfig.json'))
    const output = checked.stdout + checked.stderr
    assert.notEqual(checked.status, 0, 'Invalid types unexpectedly passed')
    assert.match(output, /invalid\.ts.*TS2322/)
    assert.match(output, /Invalid\.vue.*TS2339/)
    assert.doesNotMatch(output, /(?:legacy\.js|Legacy\.vue).*error TS/)
    assert.equal(JSON.parse(readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).compilerOptions.checkJs, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
