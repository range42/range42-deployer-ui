import { describe, expect, it } from 'vitest'
import { assetFromBytes, fileBytes, fileContentEquals, validateFileMap, MAX_FILE_BYTES, MAX_PROJECT_FILE_BYTES } from '@/services/projectFiles'

const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)

describe('project binary file content', () => {
  it.each(['abc', ['abc'], null, 4])('rejects non-map file containers %j', files => {
    expect(() => validateFileMap(files)).toThrow(/file map/i)
  })

  it('preserves all byte values through the JSON representation used by local storage and export', () => {
    const asset = assetFromBytes(bytes, 'application/octet-stream')
    expect(asset).toMatchObject({ encoding: 'base64', size: 256 })
    expect(fileBytes(JSON.parse(JSON.stringify(asset)))).toEqual(bytes)
    expect(fileContentEquals(asset, JSON.parse(JSON.stringify(asset)))).toBe(true)
    expect(fileContentEquals(asset, assetFromBytes(bytes.slice(1)))).toBe(false)
  })

  it('keeps text compatible and compares a text file with the same uploaded UTF-8 bytes', () => {
    const text = '\uFEFFRésumé 日本語\r\n'
    const asset = assetFromBytes(new TextEncoder().encode(text))
    expect(Array.from(fileBytes(text))).toEqual(Array.from(fileBytes(asset)))
    expect(fileContentEquals(text, asset)).toBe(true)
    expect(validateFileMap({ 'content/readme.txt': text, 'content/asset.bin': asset })).toBeUndefined()
  })

  it.each(['../escape', '/absolute', 'content/../bad', 'content\\bad', 'content//bad', '.git/config', 'content/./bad', 'bad\u0000name', 'bad\nname'])('rejects an unsafe repository path %j', path => {
    expect(() => validateFileMap({ [path]: 'x' })).toThrow(/path/i)
  })

  it.each([
    { encoding: 'base64', content: '%%%=', size: 1 },
    { encoding: 'base64', content: 'AQ==', size: 2 },
    { encoding: 'base64', content: 'AR==', size: 1 },
    { encoding: 'base64', content: 'AQ==\n', size: 1 },
    { encoding: 'text', content: 'AQ==', size: 1 },
  ])('rejects malformed encoded content before writing anything', content => {
    expect(() => validateFileMap({ 'content/data.bin': content })).toThrow(/content|base64|size/i)
  })

  it('enforces decoded per-file and aggregate limits with actionable errors', () => {
    expect(() => assetFromBytes(new Uint8Array(MAX_FILE_BYTES + 1))).toThrow(/1 MiB.*file/i)
    const file = assetFromBytes(new Uint8Array(MAX_FILE_BYTES))
    const files = Object.fromEntries(Array.from({ length: MAX_PROJECT_FILE_BYTES / MAX_FILE_BYTES + 1 }, (_, i) => [`content/${i}.bin`, file]))
    expect(() => validateFileMap(files)).toThrow(/2 MiB.*project/i)
  })
})
