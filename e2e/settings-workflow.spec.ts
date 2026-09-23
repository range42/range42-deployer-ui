import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { routeApi } from './fixtures/routeApi'

for (const width of [1440, 390]) {
  test(`Settings connections, targets and preferences work at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await routeApi(page)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/v1/proxmox/hosts?*', route => route.fulfill({ json: { items: [{
      id: 'pve-target', name: 'Training target', api_url: 'https://pve.test:8006', node_name: 'training-node', has_token: true, default_bridge: 'vmbr0',
    }], total: 1, offset: 0, limit: 100 } }))
    await page.route('**/v1/proxmox/hosts/pve-target/health', route => route.fulfill({ json: { status: 'ok', rtt_ms: 15, sdn_available: true, at: '2026-09-15T12:00:00Z' } }))
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Backend connections', exact: true })).toBeVisible()
    await expect(page.getByText('GitHub Authentication', { exact: true })).toHaveCount(0)
    await page.getByTestId('load-targets').click()
    await page.getByTestId('test-target').click()
    await expect(page.getByTestId('registered-target')).toContainText('SDN API available')
    await page.getByTestId('use-target-node').click()
    await expect(page.getByTestId('backend-host-row')).toContainText('training-node')
    await page.getByTestId('backend-label').fill('Second backend')
    await page.getByTestId('backend-url').fill('https://backend-b.test')
    await page.getByTestId('backend-token').fill('synthetic-backend-b-token')
    await page.getByRole('button', { name: 'Add connection', exact: true }).click()
    await page.getByTestId('active-backend').selectOption({ label: 'Second backend' })
    await expect(page.getByTestId('backend-host-row').filter({ hasText: 'Second backend' })).toContainText('Active')
    await page.reload()
    await expect(page.getByTestId('active-backend').locator('option:checked')).toHaveText('Second backend')
    await page.getByTestId('settings-link-preferences').click()
    await expect(page).toHaveURL(/tab=preferences/)
    await page.getByLabel('Theme', { exact: true }).selectOption('dark')
    await page.getByLabel('Automatically save the Git working branch').uncheck()
    await page.getByLabel('Snap nodes to grid').uncheck()
    await page.locator('#editor-grid-size').fill('35')
    await page.reload()
    await expect(page.getByLabel('Automatically save the Git working branch')).not.toBeChecked()
    await expect(page.getByLabel('Snap nodes to grid')).not.toBeChecked()
    await expect(page.locator('#editor-grid-size')).toHaveValue('35')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect((await new AxeBuilder({ page }).include('[data-testid="settings-page"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`settings-preferences-${width}.png`) })
    expect(errors).toEqual([])
    expect(api.state.writes).toEqual([])
    expect(api.state.unexpected).toEqual([])
  })

  test(`Settings validates identity, protects drafts and confirms backend policy at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await routeApi(page)
    let policy = { keep_count: 12, keep_days: 30, automatic_enforcement: false, execution: 'reviewed_snapshot_sets_only' }
    let denyWrite = false
    const writes: string[] = []
    await page.route('**/v1/auth/me', route => route.fulfill({ json: { actor_id: 'test-admin', role: 'admin', scope: 'installation', audit_enabled: false } }))
    await page.route('**/v1/admin/retention', async route => {
      if (route.request().method() === 'PUT') {
        writes.push('retention')
        if (denyWrite) return route.fulfill({ status: 403, json: { message: 'Forbidden' } })
        policy = { ...policy, ...route.request().postDataJSON() }
      }
      return route.fulfill({ json: policy })
    })
    await page.goto('/settings?tab=identity')
    await page.getByRole('button', { name: 'Save identity' }).click()
    await expect(page.getByTestId('user-display-name')).toBeFocused()
    await expect(page.getByRole('alert')).toContainText('Display name is required')
    await page.getByTestId('user-display-name').fill('Training operator')
    await page.getByRole('button', { name: 'Save identity' }).click()
    await expect(page.getByTestId('settings-user-identity').getByRole('status')).toContainText('Identity saved')
    await page.getByTestId('settings-link-snapshots').click()
    await expect(page.getByTestId('retention-keep-count')).toHaveValue('12')
    await page.getByTestId('retention-keep-count').fill('8')
    await page.getByRole('button', { name: 'Save retention policy' }).click()
    await expect(page.getByTestId('settings-snapshot-retention').getByRole('status')).toContainText('Saved on this backend')
    await page.reload()
    await expect(page.getByTestId('retention-keep-count')).toHaveValue('8')
    denyWrite = true
    await page.getByTestId('retention-keep-count').fill('9')
    await page.getByRole('button', { name: 'Save retention policy' }).click()
    await expect(page.getByRole('alert')).toContainText('administrator')
    await expect(page.getByTestId('retention-keep-count')).toHaveValue('9')
    await page.getByTestId('settings-link-connections').click()
    const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved settings?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(/tab=snapshots/)
    await expect(page.getByTestId('retention-keep-count')).toHaveValue('9')
    await page.getByTestId('retention-reload').click()
    await page.getByRole('alertdialog', { name: 'Discard retention edits?' }).getByRole('button', { name: 'Reload policy' }).click()
    await expect(page.getByTestId('retention-keep-count')).toHaveValue('8')
    expect((await new AxeBuilder({ page }).include('[data-testid="settings-page"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`settings-snapshots-${width}.png`) })
    expect(writes).toEqual(['retention', 'retention'])
    expect(api.state.unexpected).toEqual([])
  })
}
