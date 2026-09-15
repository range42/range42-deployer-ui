import { describe, expect, it, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GitLabProvider } from '@/services/git/gitlab'
import { GiteaProvider } from '@/services/git/gitea'
import { assetFromBytes, fileBytes } from '@/services/projectFiles'
import { encodeContentBase64 } from '@/services/git/encoding'

const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
const content = assetFromBytes(bytes)
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const options = { owner: 'me', repo: 'assets', branch: 'work', message: 'Upload binary', expectedHead: 'a'.repeat(40), files: [{ path: 'content/fixture.bin', content }] }

describe.each([GitHubV1Provider, GitLabProvider, GiteaProvider])('%s binary reads', Provider => {
  it('returns exact bytes and refuses to decode binary as editor text', async () => {
    const fetchImpl = vi.fn(async () => reply({ content: content.content, sha: 'blob', blob_id: 'blob', encoding: 'base64' }))
    const provider = new Provider({ fetchImpl })
    const opts = { owner: 'me', repo: 'assets', path: 'content/fixture.bin', ref: 'work' }
    const file = await provider.getFileContent(opts)
    expect(Array.from(fileBytes(file.content))).toEqual(Array.from(bytes))
    await expect(provider.getFile(opts)).rejects.toThrow(/binary.*text/i)
  })
  it('preserves UTF-8 BOM bytes in the compatible text API', async () => {
    const text = '\uFEFFRésumé 日本語\r\n'
    const provider = new Provider({ fetchImpl: async () => reply({ content: encodeContentBase64(text), sha: 'blob', blob_id: 'blob', encoding: 'base64' }) })
    expect((await provider.getFile({ owner: 'me', repo: 'assets', path: 'text.txt' })).content).toBe(text)
  })
})

it('GitHub commits binary blobs by SHA in the same atomic tree as text files', async () => {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(url)
    if (path.includes(`/git/commits/${options.expectedHead}`)) return reply({ tree: { sha: 'base' } })
    if (path.includes('/git/trees/base')) return reply({ tree: [] })
    if (path.endsWith('/git/blobs')) return reply({ sha: 'binary-blob' })
    return reply({ sha: 'commit', object: { sha: 'commit' } })
  })
  await new GitHubV1Provider({ fetchImpl }).commitFiles({ ...options, files: [...options.files, { path: 'readme.txt', content: 'hello' }] })
  const blobCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/git/blobs'))!
  expect(JSON.parse(String(blobCall[1]?.body))).toEqual({ content: content.content, encoding: 'base64' })
  const treeCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/git/trees'))!
  expect(JSON.parse(String(treeCall[1]?.body)).tree).toEqual([
    { path: 'content/fixture.bin', mode: '100644', type: 'blob', sha: 'binary-blob' },
    { path: 'readme.txt', mode: '100644', type: 'blob', content: 'hello' },
  ])
  expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body))).toEqual({ sha: 'commit', force: false })
})

it.each([GitLabProvider, GiteaProvider])('%s encodes raw bytes once in atomic payloads', async Provider => {
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => reply({ id: 'commit', commit: { sha: 'commit' } }))
  await new Provider({ fetchImpl }).commitFiles(options)
  const payload = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
  const file = (payload.actions || payload.files)[0]
  expect(file.content).toBe(content.content)
  expect(Array.from(atob(file.content), char => char.charCodeAt(0))).toEqual(Array.from(bytes))
})

describe.each([GitHubV1Provider, GitLabProvider, GiteaProvider])('%s content failures', Provider => {
  it.each([401, 404])('preserves HTTP status %i so missing files can be distinguished from denied access', async status => {
    const provider = new Provider({ fetchImpl: async () => new Response(JSON.stringify({ message: 'unavailable' }), { status }) })
    await expect(provider.getFile({ owner: 'me', repo: 'assets', path: 'fixture.bin' })).rejects.toMatchObject({ status })
  })
  it('rejects unsupported encoding instead of returning an empty or encoded text file', async () => {
    const provider = new Provider({ fetchImpl: async () => reply({ encoding: 'unsupported', content: '', sha: 'blob', blob_id: 'blob', size: 3 }) })
    await expect(provider.getFileContent({ owner: 'me', repo: 'assets', path: 'fixture.bin' })).rejects.toThrow(/encoding|content.*unavailable/i)
  })
})

it('GitHub reads a blob when the contents endpoint omits its bytes', async () => {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => reply(String(url).includes('/git/blobs/')
    ? { content: content.content, encoding: 'base64', sha: 'blob' }
    : { content: '', encoding: 'none', sha: 'blob', size: bytes.length }))
  const file = await new GitHubV1Provider({ fetchImpl }).getFileContent({ owner: 'me', repo: 'assets', path: 'fixture.bin' })
  expect(Array.from(fileBytes(file.content))).toEqual(Array.from(bytes))
  expect(String(fetchImpl.mock.calls[1][0])).toContain('/git/blobs/blob')
})

it.each([GitHubV1Provider, GiteaProvider])('%s encodes file paths without losing ref queries or Unicode bytes', async Provider => {
  const path = 'content/report#draft?copy% 日本語.bin'
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => reply(init?.method
    ? { content: { sha: 'written' } } : { encoding: 'base64', content: content.content, sha: 'blob' }))
  const provider = new Provider({ fetchImpl })
  const file = await provider.getFileContent({ owner: 'me', repo: 'assets', path, ref: 'work/branch' })
  const readUrl = new URL(String(fetchImpl.mock.calls[0][0]))
  expect(readUrl.hash).toBe('')
  expect(readUrl.pathname).toContain(`/contents/content/${encodeURIComponent(path.split('/')[1])}`)
  expect(readUrl.searchParams.get('ref')).toBe('work/branch')
  expect(Array.from(fileBytes(file.content))).toEqual(Array.from(bytes))
  await provider.putFile({ owner: 'me', repo: 'assets', path, content, branch: 'work/branch', message: 'Binary' })
  const writeUrl = new URL(String(fetchImpl.mock.calls[1][0]))
  expect(writeUrl.pathname).toBe(readUrl.pathname)
  expect(writeUrl.hash).toBe('')
  expect(writeUrl.search).toBe('')
  expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).content).toBe(content.content)
})
