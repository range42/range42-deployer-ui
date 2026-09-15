import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'
import roleFiles from '../src/__tests__/fixtures/catalogRoleNtp.json' with { type: 'json' }
import composeFiles from '../src/__tests__/fixtures/catalogComposeApache.json' with { type: 'json' }

for (const width of [1440, 390]) {
  test(`compose machines, a role and isolated workload ports in one project at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const source = { id: 'catalog', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' },
      repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }
    const machine = { name: 'Vulnerable web VM', kind: 'component', source_id: source.id, path: 'machines/web', sha: 'a'.repeat(40), document: {
      schema_version: '1.0', kind: 'component', name: 'Vulnerable web VM', nodes: [
        { id: 'web', kind: 'vm', template_vmid: 9902, config: { cores: 4, memory_mb: 4096, disk_gb: 32 } },
      ],
    } }
    const role = { name: 'service.reload.ntp', kind: 'ansible_role', source_id: source.id, path: roleFiles.path, sha: roleFiles.sha, document: {} }
    const workload = { name: 'Apache CVE-2021-42013', kind: 'container', source_id: source.id, path: composeFiles.path, sha: composeFiles.sha, document: {} }
    const entries = [machine, role, workload]
    const tree = [...roleFiles.tree, ...composeFiles.tree]
    const files = { ...roleFiles.files, ...composeFiles.files }
    const project = { id: 'composition', name: 'Security training', nodes: [
      { id: 'original', type: 'vm', position: { x: 100, y: 100 }, data: { label: 'Original machine', config: { template: 9901, cores: 1, memory: 1024 } } },
    ], edges: [], files: { 'notes.txt': 'Preserve these notes' } }
    await page.addInitScript(({ source, project }) => {
      if (localStorage.getItem('catalog-append-seeded')) return
      localStorage.setItem('range42_projects', JSON.stringify([project]))
      localStorage.setItem('range42_git_sources', JSON.stringify([source]))
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', url: location.origin, label: 'Fixture' }], activeHostId: 'backend', seeded: true }))
      localStorage.setItem('catalog-append-seeded', '1')
    }, { source, project })
    await setupMockApi(page)
    await page.route(/\/v1\/catalog\/sources(?:\?.*)?$/, route => route.fulfill({ json: { items: [source], total: 1 } }))
    await page.route(/\/v1\/catalog\/entries(?:\?.*)?$/, route => route.fulfill({ json: { items: entries, total: entries.length } }))
    await page.route(/\/v1\/catalog\/entries\/catalog\//, route => route.fulfill({ json: entries.find(entry => decodeURIComponent(route.request().url()).includes(entry.path)) }))
    const writes: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname) })
    await page.route('https://api.github.com/**', async route => {
      const url = new URL(route.request().url())
      expect(route.request().method()).toBe('GET')
      if (url.pathname.includes('/git/trees/')) return route.fulfill({ json: { tree, truncated: false } })
      if (url.pathname.includes('/contents/')) {
        const path = decodeURIComponent(url.pathname.split('/contents/')[1]) as keyof typeof files
        expect(url.searchParams.get('ref')).toBe(path.startsWith(roleFiles.path) ? roleFiles.sha : composeFiles.sha)
        return route.fulfill({ json: { content: Buffer.from(files[path]).toString('base64'), encoding: 'base64', sha: tree.find(file => file.path === path)!.sha } })
      }
      throw new Error(`Unexpected provider read ${url.pathname}`)
    })
    await page.goto('/project/composition?tab=settings')
    await page.getByTestId('project-add-catalog').click()
    await expect(page).toHaveURL(/\/catalog\?project=composition/)
    await expect(page.getByTestId('catalog-project-context')).toContainText(project.name)

    const machineCard = page.locator('article[data-kind="component"]')
    await machineCard.getByTestId('catalog-add-to-project').click()
    let dialog = page.getByTestId('catalog-append-dialog')
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await expect(dialog.locator('[name="project"]')).toHaveValue(project.id)
    await dialog.getByTestId('catalog-append-review').click()
    await expect(dialog.getByTestId('catalog-append-preview')).toContainText('9902')
    await expect(dialog.getByTestId('catalog-append-preview')).toContainText('4096')
    expect((await new AxeBuilder({ page }).include('[data-testid="catalog-append-dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await dialog.getByTestId('catalog-append-keep').click()
    await expect(page.getByRole('status').filter({ hasText: 'Added to Security training' })).toBeVisible()

    await machineCard.getByTestId('catalog-add-to-project').click()
    dialog = page.getByTestId('catalog-append-dialog')
    await dialog.locator('[name="instance-name"]').fill('second-web')
    await dialog.getByTestId('catalog-append-review').click()
    await dialog.getByTestId('catalog-append-open').click()
    await expect(page).toHaveURL(/\/project\/composition\?tab=canvas&node=/)
    let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]')[0])
    expect(saved.nodes).toHaveLength(3)
    expect(new Set(saved.nodes.map((node: { id: string }) => node.id)).size).toBe(3)
    expect(saved.nodes.find((node: { id: string }) => node.id === 'original').data.config).toEqual(project.nodes[0].data.config)
    expect(saved.files['notes.txt']).toBe('Preserve these notes')
    expect(saved.catalogImports).toHaveLength(2)
    const target = new URL(page.url()).searchParams.get('node')!
    await page.getByRole('button', { name: 'Close configuration panel' }).click()
    await expect(page.locator('#config-panel-title')).toHaveCount(0)
    await page.getByTestId('project-add-catalog').click()
    await page.locator('article[data-kind="ansible_role"]').getByTestId('catalog-add-to-project').click()
    dialog = page.getByTestId('catalog-append-dialog')
    await dialog.locator('[name="target-node"]').selectOption(target)
    await dialog.getByTestId('catalog-append-review').click()
    await dialog.getByTestId('catalog-append-open').click()
    await expect(page).toHaveURL(/tab=config/)
    expect(new URL(page.url()).searchParams.get('file')).toBe(`${roleFiles.path}/tasks/main.yml`)
    await expect(page.getByTestId('two-pane-right')).toContainText('ntp')
    await page.reload()
    await expect(page.getByTestId('two-pane-right')).toContainText('ntp')
    saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]')[0])
    expect(saved.nodes).toHaveLength(3)
    expect(saved.files['notes.txt']).toBe('Preserve these notes')
    expect(saved.scenario.content.at(-1)).toMatchObject({ kind: 'role', target_node: target, path: roleFiles.path })
    await page.getByTestId('project-add-catalog').click()
    const workloadCard = page.locator('article[data-kind="container"]')
    await workloadCard.getByTestId('catalog-add-to-project').click()
    dialog = page.getByTestId('catalog-append-dialog')
    await expect(dialog.locator('[name="target-node"]')).toHaveValue(target)
    await dialog.locator('[name="host-ports"]').fill('18080')
    await dialog.getByTestId('catalog-append-review').click()
    await expect(dialog.getByTestId('catalog-workload-preview')).toContainText('18080 → 80/tcp')
    await dialog.getByTestId('catalog-append-keep').click()
    await workloadCard.getByTestId('catalog-add-to-project').click()
    dialog = page.getByTestId('catalog-append-dialog')
    await dialog.locator('[name="host-ports"]').fill('18080')
    await dialog.getByTestId('catalog-append-review').click()
    await expect(dialog.getByRole('alert')).toContainText('already assigned')
    await dialog.locator('[name="host-ports"]').fill('18081')
    await dialog.getByTestId('catalog-append-review').click()
    await expect(dialog.getByTestId('catalog-workload-preview')).toContainText('18081 → 80/tcp')
    await dialog.getByTestId('catalog-append-open').click()
    await expect(page.getByTestId('two-pane-right')).toContainText('Catalog Compose workload')
    await page.reload()
    await expect(page.getByTestId('two-pane-right')).toContainText('Catalog Compose workload')
    saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]')[0])
    const reviews = Object.entries(saved.files).filter(([path]) => /content\/workloads\/.+\/review\.json$/.test(path)).map(([, content]) => JSON.parse(content as string))
    expect(reviews.map(review => review.published_ports).flat().sort()).toEqual(['18080/tcp', '18081/tcp'])
    expect(saved.nodes).toHaveLength(3)
    expect(saved.catalogImports).toHaveLength(5)
    expect(saved.scenario.content.filter((item: { kind: string }) => item.kind === 'playbook')).toHaveLength(2)
    await page.getByTestId('project-tab-settings').click()
    await expect(page.getByTestId('project-catalog-import')).toHaveCount(5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
