import { test, expect } from '@playwright/test'
import { routeApi } from './fixtures/routeApi'

test('sidebar language updates navigation and survives reload', async ({ page }) => {
  await routeApi(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/project/route-project')
  const sidebar = page.locator('[data-testid="project-sidebar"]').first()
  await expect(sidebar.getByRole('button', { name: 'Add virtual machine', exact: true })).toBeVisible()
  await sidebar.getByLabel('Language', { exact: true }).selectOption('fr')
  await expect(page.getByRole('navigation', { name: 'Principale', exact: true }).getByRole('link', { name: 'Projets', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Ajouter une machine virtuelle', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await page.reload()
  await expect(sidebar.getByLabel('Langue', { exact: true })).toHaveValue('fr')
  await sidebar.getByLabel('Langue', { exact: true }).selectOption('jp')
  await expect(sidebar.getByRole('button', { name: '仮想マシンを追加', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'メイン', exact: true }).getByRole('link', { name: 'プロジェクト', exact: true })).toBeVisible()
})
