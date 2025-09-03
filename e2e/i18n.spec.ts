import { test, expect } from '@playwright/test'

test('default English and runtime switch to French', async ({ page }) => {
  await page.goto('/')

  // Open create project modal
  await page.getByRole('button', { name: /new project/i }).click()
  // Fill name and create
  await page.getByPlaceholder(/enter project name/i).fill('E2E Project')
  await page.getByRole('button', { name: /^create$/i }).click()

  // We should be on project editor with sidebar
  await expect(page).toHaveURL(/\/project\//)

  // Assert English strings present in Sidebar
  await expect(page.getByText('Quick Actions').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /export topology/i })).toBeVisible()

  // Switch to French via language select
  const select = page.locator('select.select')
  await expect(select).toBeVisible()
  await select.selectOption({ label: 'Français' })

  // Assert French strings visible
  await expect(page.getByText('Actions rapides').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Exporter la topologie/i })).toBeVisible()
})

