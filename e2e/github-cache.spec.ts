import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

test('GitHub branch and lease reads see changes despite a fresh browser HTTP cache', async ({ page }) => {
  let revision = 'a'.repeat(40)
  let lease = 'original lease'
  const server = createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=60',
      'Access-Control-Allow-Origin': '*',
    })
    response.end(JSON.stringify(request.url?.includes('/contents/')
      ? { content: Buffer.from(lease).toString('base64'), encoding: 'base64', sha: revision }
      : [{ sha: revision, commit: { message: 'checkpoint', author: { name: 'test', date: '2026-09-23T00:00:00Z' } } }]))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await page.goto('/')
    const read = () => page.evaluate(async baseUrl => {
      // The real browser HTTP cache stays enabled: page.route would disable it.
      const { GitHubV1Provider } = await import('/src/services/git/github.v1.ts')
      const provider = new GitHubV1Provider({ baseUrl })
      const commits = await provider.listCommits({ owner: 'owner', repo: 'project', ref: 'working', perPage: 1 })
      const lock = await provider.getFile({ owner: 'owner', repo: 'project', ref: 'working', path: '.lock' })
      return { head: commits[0].sha, lock: lock.content }
    }, baseUrl)
    expect(await read()).toEqual({ head: revision, lock: lease })
    // A confirmed write (or another editor) advances the server's state while
    // its previous GET responses are still fresh in the browser's cache.
    revision = 'b'.repeat(40)
    lease = 'newly acquired lease'
    expect(await read()).toEqual({ head: revision, lock: lease })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
