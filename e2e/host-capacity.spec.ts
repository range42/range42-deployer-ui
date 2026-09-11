import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi, seedLocalStorage } from './fixtures/mockApi'

const gib = 1024 ** 3
const measurement = {
  host_id: 'capacity-target', node_name: 'pve01', observed_at: '2026-09-10T12:00:00Z', status: 'available',
  cpu: { logical_cpus: 8, utilization: 0.25 }, memory: { total_bytes: 16 * gib, used_bytes: 4 * gib, free_bytes: 12 * gib },
  storage: [{ storage: 'local-lvm', type: 'lvmthin', content: ['images'], enabled: true, active: true, shared: false,
    total_bytes: 100 * gib, used_bytes: 25 * gib, free_bytes: 75 * gib }],
  issues: [], limitations: ['Pool visibility depends on Proxmox permissions.'],
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`capacity: explicit authenticated target, refresh and accessible layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await seedLocalStorage(page, { migrationDone: true, projects: [{ id: 'capacity-demo', name: 'Capacity demo', nodes: [], edges: [] }] })
    await page.addInitScript(() => localStorage.setItem('range42_backend_api', JSON.stringify({
      hosts: [{ id: 'capacity-backend', url: 'http://capacity-backend.test', token: 'capacity-test-token', nodeName: 'pve01', label: 'Capacity test' }],
      activeHostId: 'capacity-backend', seeded: true,
    })))
    await setupMockApi(page)
    let reads = 0
    await page.route(/\/v1\/proxmox\/hosts(?:[/?]|$)/, async route => {
      expect(new URL(route.request().url()).origin).toBe('http://capacity-backend.test')
      expect(route.request().headers().authorization).toBe('Bearer capacity-test-token')
      if (new URL(route.request().url()).pathname.endsWith('/capacity')) {
        reads += 1
        await route.fulfill({ json: reads === 1 ? measurement : { ...measurement, status: 'partial',
          cpu: { logical_cpus: null, utilization: null }, memory: { total_bytes: null, used_bytes: null, free_bytes: 0 }, storage: [],
          issues: [{ code: 'NODE_CAPACITY_UNAVAILABLE', resource: 'node', message: 'Check Sys.Audit permissions on this node.' }] } })
      } else await route.fulfill({ json: { total: 1, items: [{ id: 'capacity-target', name: 'Measured range target', node_name: 'pve01', api_url: 'https://pve01.test:8006' }] } })
    })
    await page.goto('/project/capacity-demo')
    await expect(page.getByTestId('canvas-wrapper')).toBeVisible()
    const migration = page.getByRole('dialog', { name: 'Migrate local projects to Git' })
    if (await migration.isVisible()) await migration.getByRole('button', { name: 'Later', exact: true }).click()
    await page.locator('.dropdown').filter({ has: page.getByRole('button', { name: 'Proxmox Settings', exact: true, includeHidden: true }) }).locator('label').click()
    await page.getByRole('button', { name: 'Proxmox Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Proxmox Configuration' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Backend API URL' })).toHaveValue('http://capacity-backend.test')
    const panel = page.getByTestId('capacity-panel')
    await panel.getByRole('button', { name: 'Load capacity', exact: true }).click()
    await expect(panel.getByText('8 logical CPUs')).toBeVisible()
    await expect(panel.getByText('25%', { exact: true })).toBeVisible()
    await expect(panel.getByText('12 GiB', { exact: true })).toBeVisible()
    await expect(panel.getByText('75 GiB', { exact: true })).toBeVisible()
    await expect(panel.getByRole('combobox', { name: 'Registered Proxmox target' })).toHaveValue('capacity-target')
    const violations = (await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
    const overflow = await dialog.locator('.modal-box').evaluate(element => {
      const right = element.getBoundingClientRect().right
      return [...element.querySelectorAll('*')].filter(child => child.getBoundingClientRect().right > right + 1)
        .map(child => ({ tag: child.tagName, class: child.className, text: child.textContent?.trim().slice(0, 100) }))
    })
    expect(overflow).toEqual([])
    expect(await dialog.locator('.modal-box').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await panel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/r42-capacity-${viewport.width}.png` })
    await panel.getByRole('button', { name: 'Refresh capacity', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByText('Partial measurements', { exact: true })).toBeVisible()
    await expect(panel.getByText('0 B', { exact: true })).toBeVisible()
    await expect(panel.getByText('Check Sys.Audit permissions on this node.')).toBeVisible()
    await expect(panel.getByText('8 logical CPUs')).toHaveCount(0)
    await dialog.getByRole('textbox', { name: 'Proxmox Node' }).fill('pve02')
    await expect(panel.getByText('Partial measurements', { exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Load capacity', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(reads).toBe(2)
  })
}
