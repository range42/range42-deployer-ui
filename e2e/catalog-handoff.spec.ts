import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'
import fixture from '../src/__tests__/fixtures/catalogRoleNtp.json' with { type: 'json' }

for (const width of [1440, 390]) {
  test(`default catalog role uses a reviewed repository and preserves files at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const entry = { name: 'service.reload.ntp', kind: 'ansible_role', source_id: 'catalog', path: fixture.path, sha: fixture.sha, document: {} }
    const source = { id: 'catalog', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' },
      repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }], writable: false }
    await page.addInitScript(source => {
      if (localStorage.getItem('catalog-handoff-seeded')) return
      localStorage.setItem('range42_projects', JSON.stringify([{ id: 'existing', name: 'Keep this project', nodes: [], edges: [] }]))
      localStorage.setItem('range42_git_sources', JSON.stringify([source]))
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', url: location.origin, label: 'Fixture' }], activeHostId: 'backend', seeded: true }))
      localStorage.setItem('catalog-handoff-seeded', '1')
    }, source)
    await setupMockApi(page)
    await page.route(/\/v1\/catalog\/sources(?:\?.*)?$/, route => route.fulfill({ json: { items: [source], total: 1 } }))
    await page.route(/\/v1\/catalog\/entries(?:\?.*)?$/, route => route.fulfill({ json: { items: [entry], total: 1 } }))
    await page.route(/\/v1\/catalog\/entries\/catalog\//, route => route.fulfill({ json: entry }))
    const writes: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('https://api.github.com/**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: { message: 'Acceptance is read-only' } }) }
      if (url.pathname === '/repos/me/work') return route.fulfill({ json: { permissions: { push: true } } })
      if (url.pathname.endsWith('/commits')) return route.fulfill({ status: url.searchParams.get('sha')?.startsWith('range42-ui/') ? 404 : 200,
        json: url.searchParams.get('sha')?.startsWith('range42-ui/') ? { message: 'Not Found' } : [{ sha: 'b'.repeat(40), commit: { message: 'Base', author: {} } }] })
      if (url.pathname.includes('/git/trees/')) return route.fulfill({ json: { tree: url.pathname.includes('/range42/catalog/') ? fixture.tree : [], truncated: false } })
      if (url.pathname.includes('/contents/')) {
        const path = decodeURIComponent(url.pathname.split('/contents/')[1]) as keyof typeof fixture.files
        expect(url.searchParams.get('ref')).toBe(fixture.sha)
        return route.fulfill({ json: { content: Buffer.from(fixture.files[path]).toString('base64'), encoding: 'base64',
          sha: fixture.tree.find(file => file.path === path)!.sha } })
      }
      throw new Error(`Unexpected provider read ${url.pathname}`)
    })
    await page.goto('/catalog')
    await page.getByRole('button', { name: 'Customize', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByTestId('repository-owner').fill('me')
    await page.getByTestId('repository-name').fill('work')
    await page.getByTestId('repository-subdir').fill('projects/ntp')
    await page.getByTestId('connect-project-repository').click()
    await expect(page.getByTestId('catalog-handoff-preview')).toContainText('7 role files')
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByTestId('catalog-handoff-import').click()
    await expect(page).toHaveURL(/\/project\/project_[a-f0-9]+\?tab=config$/)
    await expect(page.getByTestId('file-tree-list')).toBeVisible()
    await expect(page.getByTestId('project-catalog-origin')).toContainText(fixture.path)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]'))
    expect(saved).toHaveLength(2)
    expect(saved[0].id).toBe('existing')
    expect(saved[1].files).toEqual(fixture.files)
    expect(saved[1].git).toMatchObject({ repo_owner: 'me', repo_name: 'work', branch_from: 'b'.repeat(40) })
    expect(saved[1].catalogRef).toMatchObject({ repo_owner: 'range42', path: fixture.path, sha: fixture.sha })
    await page.reload()
    await expect(page.getByTestId('project-catalog-origin')).toContainText(fixture.sha)
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
