import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'

for (const width of [1440, 390]) {
  test(`catalog navigation retains browsing state and supports direct detail onboarding at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const source = { id: 'public', provider: 'github', base_url: 'https://github.com', auth_kind: 'none', has_token: false,
      repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }
    const entries = Array.from({ length: 55 }, (_, index) => ({ name: `Training machine ${index}`, kind: 'component', source_id: source.id, path: `machines/${index}`, sha: 'a'.repeat(40), description: 'Reusable machine for a security training project.', os: 'Ubuntu', tags: ['training', 'web'],
      readme_md: '# Training machine\n\nSelect your **template** and network before deployment.\n\n- Select a template\n- Review networking\n\n[Documentation](https://docs.example/guide)\n\n![Diagram](https://images.example/diagram.svg)\n\n[Invalid](javascript:alert%281%29)\n\n<script>window.untrustedCatalog = true</script>',
      document: { schema_version: '1.0', kind: 'component', name: `Training machine ${index}`, nodes: [{ id: 'vm', kind: 'vm', template_vmid: 9901, config: { cores: 2, memory_mb: 2048, disk_gb: 32 } }] } }))
    await page.addInitScript(() => {
      if (localStorage.getItem('catalog-browse-seeded')) return
      localStorage.setItem('range42_projects', JSON.stringify([{ id: 'training', name: 'Training project', nodes: [], edges: [], files: {} }]))
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', url: location.origin, label: 'Fixture' }], activeHostId: 'backend', seeded: true }))
      localStorage.setItem('catalog-browse-seeded', '1')
    })
    await setupMockApi(page)
    await page.route(/\/v1\/catalog\/sources(?:\?.*)?$/, route => route.fulfill({ json: { items: [source], total: 1 } }))
    await page.route(/\/v1\/catalog\/entries(?:\?.*)?$/, route => route.fulfill({ json: { items: entries, total: entries.length } }))
    await page.route(/\/v1\/catalog\/entries\/public\//, route => route.fulfill({ json: entries.find(entry => new URL(route.request().url()).pathname.endsWith(entry.path)) }))
    const errors: string[] = [], imageRequests: string[] = []
    await page.route('https://images.example/**', route => { imageRequests.push(route.request().url()); return route.abort() })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/catalog?q=Training&kind=component&shown=48&project=training')
    await expect(page.locator('article[data-kind]')).toHaveCount(48)
    await expect(page.locator('#catalog-search')).toHaveValue('Training')
    expect((await new AxeBuilder({ page }).include('[data-testid="catalog-grid"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath('catalog.png') })
    await page.locator('article h3 a').first().click()
    await expect(page.getByTestId('entry-requirements')).toContainText('2048')
    await page.reload()
    await expect(page.getByTestId('catalog-add-to-project')).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.evaluate(() => 'untrustedCatalog' in window)).toBe(false)
    const readme = page.getByTestId('catalog-readme-preview')
    await expect(readme.getByRole('heading', { name: 'Training machine' })).toBeVisible()
    await expect(readme.locator('ul li')).toHaveCount(2)
    await expect(readme.locator('script, img, iframe, [href^="javascript:"]')).toHaveCount(0)
    await expect(readme.getByRole('link', { name: 'Diagram' })).toHaveAttribute('href', 'https://images.example/diagram.svg')
    expect(imageRequests).toEqual([])
    expect((await new AxeBuilder({ page }).include('[data-testid="entry-readme"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    expect((await new AxeBuilder({ page }).include('[data-testid="entry-requirements"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath('catalog-detail.png') })
    await page.getByTestId('catalog-add-to-project').click()
    await expect(page.locator('[name="project"]')).toHaveValue('training')
    await page.getByTestId('catalog-append-review').click()
    await expect(page.getByTestId('catalog-append-preview')).toBeVisible()
    await page.getByTestId('catalog-append-close').click()
    await page.getByRole('link', { name: 'Back to catalog' }).click()
    await expect(page.locator('article[data-kind]')).toHaveCount(48)
    await page.locator('#catalog-search').fill('machine 54')
    await expect(page.locator('article[data-kind]')).toHaveCount(1)
    await expect(page).toHaveURL(/q=machine\+54/)
    expect(new URL(page.url()).searchParams.has('shown')).toBe(false)
    expect(errors).toEqual([])
  })
}
