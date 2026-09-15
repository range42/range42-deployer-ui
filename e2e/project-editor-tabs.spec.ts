import { test, expect } from '@playwright/test'
import { routeApi } from './fixtures/routeApi'

for (const width of [1440, 390]) {
  test(`project tabs restore selected files, node settings and catalog context at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const project = { id: 'editor-tabs', name: 'Prefilled project', nodes: [
      { id: 'guest', type: 'vm', position: { x: 80, y: 80 }, data: { config: { name: 'Configured guest', cores: 6, memory_mb: 6144, disk_gb: 48 } } },
      { id: 'network', type: 'network-segment', position: { x: 320, y: 100 }, data: { config: { name: 'Local network', cidr: '10.42.17.0/24', gateway: '10.42.17.1', snat: false } } },
    ], edges: [{ id: 'nic', source: 'guest', target: 'network' }],
    files: { 'first.yml': 'first: saved\n', 'second.yml': 'second: saved\n' },
    baseDoc: { env: [{ name: 'GREETING', default: 'hello' }] }, overlay: { param_overrides: { env: { GREETING: 'saved override' } } } }
    const api = await routeApi(page, [project]), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/project/editor-tabs?tab=config&file=second.yml')
    const content = page.getByTestId('two-pane-right').locator('.cm-content')
    await expect(content).toHaveText('second: saved')
    await page.getByTestId('project-tab-variables').click()
    await expect(page.getByTestId('override-GREETING')).toHaveValue('saved override')
    await page.goBack()
    await expect(content).toHaveText('second: saved')
    await page.reload()
    await expect(content).toHaveText('second: saved')
    await page.getByTestId('project-tab-config').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('project-tab-variables')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByTestId('project-settings-name')).toHaveValue('Prefilled project')
    await page.getByTestId('project-settings-name').fill('Renamed project')
    await page.getByRole('button', { name: 'Save project name', exact: true }).click()
    await page.reload()
    await expect(page.getByTestId('project-settings-name')).toHaveValue('Renamed project')
    expect(await page.locator('[data-testid="tab-settings"]').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)

    await page.goto('/project/editor-tabs?tab=canvas&node=guest')
    const nodeDialog = page.getByRole('dialog')
    await expect(nodeDialog.getByLabel('CPU Cores', { exact: true })).toHaveValue('6')
    await expect(nodeDialog.getByLabel('Memory (MB)', { exact: true })).toHaveValue('6144')
    await expect(nodeDialog.getByLabel('Disk', { exact: true })).toHaveValue('48G')
    await nodeDialog.getByRole('button', { name: 'Close configuration panel', exact: true }).click()
    await page.getByTestId('project-scenario').click()
    await expect(page.getByTestId('scenario-vm-cores')).toHaveValue('6')
    await expect(page.getByTestId('scenario-vm-memory')).toHaveValue('6144')
    await expect(page.getByLabel('Disk size (GiB)', { exact: true })).toHaveValue('48')
    await expect(page.getByLabel('Outbound NAT', { exact: true })).not.toBeChecked()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByTestId('project-add-catalog').click()
    await expect(page).toHaveURL(/\/catalog\?project=editor-tabs$/)
    await expect(page.getByTestId('catalog-grid')).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]')[0].files)).toEqual(project.files)
    expect(api.state.writes).toEqual([])
    expect(api.state.unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
