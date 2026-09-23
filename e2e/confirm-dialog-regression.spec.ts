import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { routeApi } from './fixtures/routeApi'

for (const width of [1440, 390]) {
  test(`shared confirmation closes and releases focus after cancellation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await routeApi(page)
    const errors: string[] = [], warnings: string[] = []
    page.on('pageerror', error => errors.push(error.stack || error.message))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) warnings.push(message.text()) })
    try {
      await page.goto('/settings')
      await page.getByTestId('backend-url').fill('https://unsaved.example')
      await page.getByTestId('settings-link-identity').click()
      const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved settings?' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Discard changes', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toHaveCount(0, { timeout: 3000 })
      await expect(page.getByTestId('settings-link-identity')).toBeFocused()
      await expect(page.getByTestId('backend-url')).toHaveValue('https://unsaved.example')
      await page.getByTestId('settings-link-identity').click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(page.getByTestId('settings-link-identity')).toBeFocused()
      await expect(page.getByTestId('backend-url')).toHaveValue('https://unsaved.example')
      await page.getByTestId('settings-link-identity').click()
      await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL(/tab=identity/)
      expect(errors).toEqual([])
      expect(api.state.writes).toEqual([])
    } finally {
      const path = testInfo.outputPath('browser-diagnostics.json')
      await writeFile(path, JSON.stringify({ errors, warnings }, null, 2))
      await testInfo.attach('browser-diagnostics', { contentType: 'application/json', path })
    }
  })
}
