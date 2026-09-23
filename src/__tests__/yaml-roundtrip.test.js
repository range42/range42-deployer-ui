import { describe, it, expect } from 'vitest'
import {
  parseYamlDoc,
  stringifyYamlDoc,
  hasAnchorsOrAliases,
} from '@/services/yaml'

describe('yaml round-trip', () => {
  it('preserves comments + quoted strings on unchanged content', () => {
    const source = [
      '# top-level comment',
      'name: "example"',
      'values:',
      '  # inner comment',
      '  - 1',
      '  - 2',
      '',
    ].join('\n')
    const doc = parseYamlDoc(source)
    const out = stringifyYamlDoc(doc)
    expect(out).toContain('# top-level comment')
    expect(out).toContain('# inner comment')
    expect(out).toContain('"example"')
    // unchanged structural content round-trips
    expect(out.split('\n').filter(Boolean).length).toBe(
      source.split('\n').filter(Boolean).length,
    )
  })

  it('detects anchors + merge aliases (<<: *defaults)', () => {
    const source = [
      'defaults: &defaults',
      '  timeout: 30',
      '  retries: 3',
      'service:',
      '  <<: *defaults',
      '  name: svc',
      '',
    ].join('\n')
    const doc = parseYamlDoc(source)
    expect(hasAnchorsOrAliases(doc)).toBe(true)
  })

  it('returns false for plain YAML without anchors', () => {
    const doc = parseYamlDoc('name: plain\nvalue: 42\n')
    expect(hasAnchorsOrAliases(doc)).toBe(false)
  })

  it('hasAnchorsOrAliases is synchronous (no Promise)', () => {
    const doc = parseYamlDoc('foo: bar\n')
    const ret = hasAnchorsOrAliases(doc)
    expect(typeof ret).toBe('boolean')
    expect(ret).not.toBeInstanceOf(Promise)
  })
})
