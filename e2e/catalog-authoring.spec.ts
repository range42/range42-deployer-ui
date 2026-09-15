import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'

for (const width of [1440, 390]) {
  test(`Compose authoring reviews text-file rows and rejects duplicate paths at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    await page.addInitScript(() => {
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', url: location.origin, label: 'Fixture' }], activeHostId: 'backend', seeded: true }))
    })
    await setupMockApi(page)
    await page.route(/\/v1\/catalog\/(?:sources|entries)(?:\?.*)?$/, route => route.fulfill({ json: { items: [], total: 0 } }))
    const errors: string[] = [], writes: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()) })
    await page.goto('/catalog')
    await page.getByText('New catalog item', { exact: true }).click()
    await page.getByTestId('new-catalog-container').click()
    const dialog = page.getByRole('dialog')
    await expect(page.getByTestId('new-catalog-role')).not.toBeVisible()
    await dialog.locator('[name="target"]').fill('training_web')
    await dialog.locator('[name="description"]').fill('A training web server')
    await dialog.locator('[name="compose"]').fill('services:\n  web:\n    image: nginx:alpine\n    volumes: ["./site:/usr/share/nginx/html:ro"]\n')
    await dialog.getByTestId('container-add-file').click()
    await dialog.locator('[name="file-path-0"]').fill('site/index.html')
    await dialog.locator('[name="file-content-0"]').fill('<h1>Training page</h1>\n')
    await dialog.getByRole('button', { name: 'Preview files', exact: true }).click()
    await expect(dialog.getByTestId('container-file-preview')).toHaveCount(4)
    await expect(dialog.getByTestId('container-continue')).toBeVisible()
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await dialog.getByTestId('container-add-file').click()
    await expect(dialog.getByTestId('container-continue')).toHaveCount(0)
    await dialog.locator('[name="file-path-1"]').fill('site/index.html')
    await dialog.locator('[name="file-content-1"]').fill('Should not replace the original')
    await dialog.getByRole('button', { name: 'Preview files', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Duplicate file path')
    await expect(dialog.getByTestId('container-continue')).toHaveCount(0)
    await dialog.getByTestId('container-remove-file-1').click()
    await dialog.getByRole('button', { name: 'Preview files', exact: true }).click()
    await expect(dialog.getByTestId('container-file-preview').filter({ hasText: 'site/index.html' }).last()).toContainText('<h1>Training page</h1>')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await dialog.locator('.modal-box').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('compose-files.png') })
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
