import { test, expect } from '@playwright/test'
import { customSimulation, pictureBytes } from '../src/__tests__/fixtures/customSimulation'
import { routeApi } from './fixtures/routeApi'

for (const width of [1440, 390]) {
  test(`imported custom application retains its picture and reviewable ownership at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const { project } = await customSimulation('imported-application')
    const api = await routeApi(page, [])
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles({ name: 'application.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    await expect(page).toHaveURL(`/project/${project.id}`)
    await page.getByRole('tab', { name: 'Config', exact: true }).click()
    const assetPath = `scenarios/${project.scenario.label}/content/workloads/web/payload/site/logo.png`
    await page.locator(`[data-path="${assetPath}"]`).click()
    await expect(page.getByTestId('asset-download')).toHaveAttribute('href', `data:application/octet-stream;base64,${Buffer.from(pictureBytes).toString('base64')}`)
    await page.getByTestId('workload-review').click()
    await expect(page.getByTestId('workload-review-summary')).toContainText('site/logo.png')
    await page.getByTestId('workload-review-apply').click()
    expect(api.state.writes).toEqual([])
  })

  test(`duplicate managed application import displays recovery guidance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const { project } = await customSimulation('existing-application')
    const api = await routeApi(page, [project])
    await page.goto('/')
    const before = await page.evaluate(() => localStorage.getItem('range42_projects'))
    await page.locator('input[type="file"]').setInputFiles({ name: 'application.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    await expect(page.getByRole('alert')).toContainText('Open the existing project')
    await expect(page.getByRole('alert')).toContainText('export')
    await expect(page).toHaveURL('/')
    expect(await page.evaluate(() => localStorage.getItem('range42_projects'))).toBe(before)
    expect(api.state.writes).toEqual([])
  })
}
