import { describe, expect, it } from 'vitest'
import { bundleDefaults, bundleParameters, validateBundleParameters } from '@/services/bundleParameters'

const descriptors = [
  { name: 'TARGET_ANSIBLE_HOST', type: 'string', required: true, target: true },
  { name: 'vault_key', type: 'string', required: true, from_vault: true, default: 'never-store' },
  { name: 'PORT', type: 'int', required: true, default: 8080 },
  { name: 'ENABLED', type: 'bool', bool_style: 'yesno', default: 'YES' },
  { name: 'PACKAGES', type: 'list', default: [] },
  { name: 'MODE', type: 'string', allowed: ['safe', 'test'], required: true },
]

describe('bundle descriptor parameters', () => {
  it('seeds editable defaults while keeping target and vault values out of saved input', () => {
    expect(bundleDefaults(descriptors)).toEqual({ PORT: 8080, ENABLED: true, PACKAGES: '[]', MODE: '' })
  })
  it('validates typed values and preserves the bundle boolean convention', () => {
    expect(bundleParameters(descriptors, { PORT: '8081', ENABLED: false, PACKAGES: '["curl"]', MODE: 'safe' }))
      .toEqual({ PORT: 8081, ENABLED: 'NO', PACKAGES: ['curl'], MODE: 'safe' })
  })
  it.each([
    [{ PORT: '1.2', MODE: 'safe' }, /PORT/],
    [{ PORT: 80, MODE: 'other' }, /MODE/],
    [{ PORT: 80 }, /MODE/],
    [{ PORT: 80, MODE: 'safe', PACKAGES: '{}' }, /PACKAGES/],
    [{ PORT: 80, MODE: 'safe', vault_key: 'secret' }, /vault_key/],
    [{ PORT: 80, MODE: 'safe', TARGET_ANSIBLE_HOST: 'all' }, /TARGET_ANSIBLE_HOST/],
    [{ PORT: 80, MODE: 'safe', undeclared: true }, /undeclared/],
  ])('rejects invalid or managed parameters %j', (values, message) => {
    expect(() => bundleParameters(descriptors, values)).toThrow(message)
  })
  it('keeps optional expression defaults inside the bundle instead of forcing them into typed inputs', () => {
    const params = [{ name: 'PORT', type: 'int', default: '{{ default_port }}' }]
    expect(bundleDefaults(params)).toEqual({ PORT: '' })
    expect(bundleParameters(params, { PORT: '' })).toEqual({})
  })
  it('honors backend target_vars even when a descriptor omits the target flag', () => {
    const params = [{ name: 'global_vm_ssh_name', type: 'string', required: true }]
    expect(bundleDefaults(params, ['global_vm_ssh_name'])).toEqual({})
    expect(bundleParameters(params, {}, ['global_vm_ssh_name'])).toEqual({})
  })
  it.each(['ansible_host', 'ansible_connection', 'ansible_user', 'ansible_port'])('keeps %s under backend control even if the descriptor exposes it', name => {
    const params = [{ name, type: 'string', required: true, default: 'never-export' }]
    expect(bundleDefaults(params)).toEqual({})
    expect(() => validateBundleParameters(params, { [name]: 'override' })).toThrow(/managed/i)
  })
  it('rejects duplicated or invalid descriptor names and unsupported types', () => {
    expect(() => bundleDefaults([{ name: '__proto__', type: 'string' }])).toThrow(/name/i)
    expect(() => bundleDefaults([{ name: 'X' }, { name: 'X' }])).toThrow(/duplicate/i)
    expect(() => bundleParameters([{ name: 'X', type: 'binary' }], { X: 'a' })).toThrow(/type/i)
  })
})


describe('stored bundle parameter validation', () => {
  const params = [
    { name: 'FLAG', type: 'bool', bool_style: 'yesno' },
    { name: 'COUNT', type: 'int' },
    { name: 'OPTIONS', type: 'dict' },
    { name: 'MODE', type: 'str', enum: ['safe'] },
  ]
  it('validates existing canonical values without changing them', () => {
    const values = { FLAG: 'YES', COUNT: 2, OPTIONS: { enabled: true }, MODE: 'safe' }
    validateBundleParameters(params, values)
    expect(values).toEqual({ FLAG: 'YES', COUNT: 2, OPTIONS: { enabled: true }, MODE: 'safe' })
  })
  it.each([{ FLAG: true }, { COUNT: '2' }, { OPTIONS: '{}' }, { MODE: 'other' }, { OPTIONS: { content: '{{ secrets }}' } }, { UNKNOWN: true }])('rejects malformed saved values %j', values => {
    expect(() => validateBundleParameters(params, values)).toThrow()
  })
  it('allows the backend to inherit descriptor defaults and default locations', () => {
    const params = [{ name: 'PORT', type: 'int', required: true, default: 80 }, { name: 'SETTING', required: true, default_where: 'role-defaults' }]
    expect(bundleParameters(params, { PORT: '', SETTING: '' })).toEqual({})
  })
  it('does not copy template expressions from bundle defaults into caller variables', () => {
    expect(bundleDefaults([{ name: 'PATH', default: '/home/{{ operator }}/files' }])).toEqual({ PATH: '' })
    expect(() => bundleParameters([{ name: 'PATH' }], { PATH: '{{ ansible_host }}' })).toThrow(/template/i)
  })
  it('accepts JSON objects and validates descriptor enum aliases', () => {
    expect(bundleDefaults([{ name: 'OPTIONS', type: 'dict', default: { enabled: true } }])).toEqual({ OPTIONS: '{\n  "enabled": true\n}' })
    expect(bundleParameters(params, { OPTIONS: '{"enabled":true}', MODE: 'safe' })).toEqual({ OPTIONS: { enabled: true }, MODE: 'safe' })
  })
})
