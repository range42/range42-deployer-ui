import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'
import role from '../src/__tests__/fixtures/catalogRoleNtp.json' with { type: 'json' }

for (const width of [1440, 390]) {
  test(`append a private catalog role with a separate browser credential at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const source = { id: 'private', provider: 'github', base_url: 'https://github.com', auth_kind: 'pat', has_token: true,
      repos: [{ owner: 'owner', repo: 'private-catalog', branch: 'main' }] }
    const entry = { name: 'Private NTP role', kind: 'ansible_role', source_id: source.id, path: role.path, sha: role.sha, document: {} }
    const project = { id: 'private-append', name: 'Private training', nodes: [{ id: 'vm', type: 'vm', position: { x: 100, y: 100 }, data: { label: 'Target VM', config: { template: 9901 } } }], edges: [], files: { 'notes.txt': 'Preserve notes' },
      git: { source_id: 'destination', provider: 'github', base_url: 'https://github.com', repo_owner: 'owner', repo_name: 'different-project', working_branch: 'range42-ui/private-append' } }
    await page.addInitScript(project => {
      if (localStorage.getItem('private-append-seeded')) return
      localStorage.setItem('range42_projects', JSON.stringify([project]))
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', url: location.origin, label: 'Fixture', token: 'backend-only-token' }], activeHostId: 'backend', seeded: true }))
      localStorage.setItem('private-append-seeded', '1')
    }, project)
    await setupMockApi(page)
    await page.route(/\/v1\/catalog\/sources(?:\?.*)?$/, route => route.fulfill({ json: { items: [source], total: 1 } }))
    await page.route(/\/v1\/catalog\/entries(?:\?.*)?$/, route => route.fulfill({ json: { items: [entry], total: 1 } }))
    await page.route(/\/v1\/catalog\/entries\/private\//, route => route.fulfill({ json: entry }))
    const writes: string[] = [], errors: string[] = [], providerHeaders: Array<string | undefined> = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname) })
    await page.route('https://api.github.com/**', async route => {
      expect(route.request().method()).toBe('GET')
      const token = route.request().headers().authorization
      providerHeaders.push(token)
      if (token !== 'Bearer private-read-token') return route.fulfill({ status: 404, json: { message: 'Not Found' } })
      const url = new URL(route.request().url())
      expect(url.pathname).toMatch(/^\/repos\/owner\/private-catalog\//)
      if (url.pathname.includes('/git/trees/')) {
        expect(url.pathname.endsWith(`/git/trees/${role.sha}`)).toBe(true)
        return route.fulfill({ json: { tree: role.tree, truncated: false } })
      }
      expect(url.pathname).toContain('/contents/')
      const path = decodeURIComponent(url.pathname.split('/contents/')[1]) as keyof typeof role.files
      expect(url.searchParams.get('ref')).toBe(role.sha)
      return route.fulfill({ json: { content: Buffer.from(role.files[path]).toString('base64'), encoding: 'base64', sha: role.tree.find(file => file.path === path)!.sha } })
    })
    await page.goto('/catalog?project=private-append&node=vm')
    await page.locator('article[data-kind="ansible_role"]').getByTestId('catalog-add-to-project').click()
    const dialog = page.getByTestId('catalog-append-dialog')
    const savedProject = () => page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]')[0])
    await expect(dialog.locator('[name="project"]')).toHaveValue(project.id)
    await expect(dialog.locator('[name="target-node"]')).toHaveValue('vm')
    await dialog.getByTestId('catalog-append-review').click()
    await expect(dialog.locator('#catalog-append-error')).toContainText('404')
    expect(providerHeaders).toEqual([undefined])
    expect(await savedProject()).toEqual(project)
    await expect(dialog.getByTestId('catalog-append-preview')).toHaveCount(0)
    await dialog.getByTestId('catalog-read-access').locator('summary').click()
    await dialog.getByTestId('catalog-read-token').fill('private-read-token')
    await dialog.getByTestId('catalog-save-read-token').click()
    await expect(dialog.getByTestId('catalog-read-token')).toHaveValue('')
    await expect(dialog.getByTestId('catalog-read-credential-status')).toContainText('saved')
    expect(providerHeaders).toHaveLength(1)
    await expect(dialog.locator('[name="project"]')).toHaveValue(project.id)
    await expect(dialog.locator('[name="target-node"]')).toHaveValue('vm')
    expect(await savedProject()).toEqual(project)
    expect(writes).toEqual([])
    expect((await new AxeBuilder({ page }).include('[data-testid="catalog-append-dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await dialog.getByTestId('catalog-append-review').click()
    await expect(dialog.getByTestId('catalog-append-preview')).toBeVisible()
    expect(await savedProject()).toEqual(project)
    await dialog.getByTestId('catalog-append-keep').click()
    await page.reload()
    const saved = await savedProject()
    expect(saved.git).toEqual(project.git)
    expect(saved.files).toEqual({ ...project.files, ...role.files })
    expect(saved.nodes).toEqual(project.nodes)
    expect(saved.scenario.content).toHaveLength(1)
    expect(saved.scenario.content[0]).toMatchObject({ kind: 'role', target_node: 'vm', path: role.path })
    expect(saved.catalogImports).toHaveLength(1)
    expect(saved.catalogImports[0].origin).toMatchObject({ source_id: source.id, repo_owner: 'owner', repo_name: 'private-catalog', path: role.path, sha: role.sha })
    expect(JSON.stringify(saved)).not.toContain('private-read-token')
    expect(providerHeaders.length).toBe(2 + Object.keys(role.files).length)
    expect(providerHeaders.slice(1).every(token => token === 'Bearer private-read-token')).toBe(true)
    await page.locator('article[data-kind="ansible_role"]').getByTestId('catalog-add-to-project').click()
    await dialog.getByTestId('catalog-read-access').locator('summary').click()
    await expect(dialog.getByTestId('catalog-read-token')).toHaveValue('')
    await expect(dialog.getByTestId('catalog-read-access')).toContainText('A browser Git token is stored for this source')
    await expect(dialog.locator('[name="project"]')).toHaveValue(project.id)
    await expect(dialog.locator('[name="target-node"]')).toHaveValue('vm')
    await dialog.getByTestId('catalog-append-close').click()
    expect(await savedProject()).toEqual(saved)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
