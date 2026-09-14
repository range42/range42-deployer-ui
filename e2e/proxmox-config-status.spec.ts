import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalStorage, setupMockApi } from './fixtures/mockApi'

for (const width of [1280, 390]) {
  test(`configuration review preserves edits and only reads the selected host at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedLocalStorage(page, { migrationDone: true, projects: [{
      id: 'config-review', name: 'Config review', edges: [], nodes: [{
        id: 'guest-42', type: 'vm', position: { x: 100, y: 100 }, data: {
          deployed: true, vmId: 42, name: 'Observed', label: 'Observed', status: 'running',
          config: { name: 'Observed', cores: 2, memory: 1024, proxmoxNode: 'pve-b' },
          actualConfig: { name: 'Observed', cores: 2, memory: 1024, tags: [], description: '' },
          desiredConfig: { name: 'Wanted', cores: 4, memory: 2048, tags: ['wanted'], description: '' },
        },
      }],
    }] })
    await page.addInitScript(() => {
      document.cookie = 'range42.settings.config-review=' + encodeURIComponent(JSON.stringify({ backendApiUrl: location.origin, proxmoxNode: 'pve-b' })) + '; path=/'
      localStorage.setItem('range42_backend_api', JSON.stringify({
      hosts: [{ id: 'backend', label: 'Fixture', url: location.origin, nodeName: 'pve-b' }],
      activeHostId: 'backend', seeded: true,
      }))
    })
    await setupMockApi(page)
    const writes: string[] = [], reads: string[] = []
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()) })
    await page.route(/\/v1\/proxmox\/hosts(?:[/?]|$)/, async route => {
      const path = new URL(route.request().url()).pathname
      reads.push(path)
      if (path.endsWith('/hosts')) await route.fulfill({ json: { offset: 0, total: 2, items: [
        { id: 'wrong', node_name: 'pve-a' }, { id: 'selected', node_name: 'pve-b' },
      ] } })
      else if (path.endsWith('/config')) await route.fulfill({ json: { config: { name: 'From Proxmox', cores: 3, memory: 1536 } } })
      else await route.fulfill({ json: { items: [] } })
    })
    await page.goto('/project/config-review')
    await page.locator('.vue-flow__node[data-id="guest-42"]').click()
    await page.locator('.modal-open').getByRole('button', { name: 'Apply', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Apply Changes — Wanted' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Apply Changes', exact: true })).toBeDisabled()
    await expect(dialog).toContainText('selected host')
    await dialog.getByRole('button', { name: 'Refresh actual configuration' }).click()
    await expect(dialog.getByRole('status')).toContainText('Actual configuration refreshed')
    await expect(dialog).toContainText('From Proxmox')
    await expect(dialog).toContainText('Wanted')
    expect(reads).toContain('/v1/proxmox/hosts/selected/vms/42/config')
    expect(reads.some(path => path.includes('/wrong/'))).toBe(false)
    expect(writes).toEqual([])
    expect(await dialog.locator('.modal-box').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="apply-changes-title"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).not.toBeVisible()
  })
}
