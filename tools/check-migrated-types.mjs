import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

export function verifyMigratedFiles(root, files) {
  assert.ok(Array.isArray(files) && files.length > 0, 'List the checked JavaScript implementation files')
  assert.equal(new Set(files).size, files.length, 'Migrated-file list contains duplicates')
  for (const name of files) {
    assert.match(name, /^src\/.+\.(?:js|vue)$/)
    assert.ok(!name.split('/').includes('..') && !name.includes('/__tests__/'), 'Only implementation sources may be migrated')
    const source = readFileSync(path.join(root, name), 'utf8')
    const blocks = name.endsWith('.vue')
      ? (() => { const { descriptor, errors } = parse(source, { filename: name }); assert.equal(errors.length, 0, `Cannot parse ${name}`); return [descriptor.script, descriptor.scriptSetup].filter(Boolean) })()
      : [{ content: source, lang: 'js' }]
    assert.ok(blocks.length > 0, `No script in migrated file ${name}`)
    for (const block of blocks) {
      assert.ok(!block.lang || block.lang === 'js', `Use the ordinary TypeScript gate for ${name}`)
      const comments = (ts.getLeadingCommentRanges(block.content, 0) || []).map(range => block.content.slice(range.pos, range.end))
      assert.ok(comments.some(comment => /^\/\/\s*@ts-check\s*$/.test(comment)), `Missing leading @ts-check in ${name}`)
      assert.ok(!/@ts-nocheck/.test(block.content), `Unchecked override in ${name}`)
    }
  }
  return files.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const count = verifyMigratedFiles(root, JSON.parse(readFileSync(path.join(root, 'typecheck-migrated.json'), 'utf8')))
  process.stdout.write(`Verified @ts-check coverage for ${count} migrated JavaScript sources\n`)
}
