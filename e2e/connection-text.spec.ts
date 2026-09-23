import { expect, test } from '@playwright/test'
import { routeApi } from './fixtures/routeApi'

test('edits text at the middle of annotation and network lines and reopens it', async ({ page }) => {
  const api = await routeApi(page, [{ id: 'lines', name: 'Connections', nodes: [
    { id: 'vm', type: 'vm', position: { x: 100, y: 100 }, data: { config: { name: 'Example VM' } } },
    { id: 'net', type: 'network-segment', position: { x: 550, y: 400 }, data: { config: { name: 'Example network', bridge: 'vmbr10' } } },
    { id: 'note', type: 'note', position: { x: 100, y: 700 }, style: { width: '320px', height: '200px' }, data: { config: { name: 'Review', text: 'Example' } } },
  ], edges: [
    { id: 'network-link', type: 'network', source: 'vm', target: 'net', label: 'Service traffic', data: { connection: { interfaceName: 'net0', ipAddress: '10.10.0.10/24' } } },
    { id: 'annotation', type: 'smoothstep', source: 'note', target: 'net', label: 'Review link' },
  ] }])
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/project/lines')
  await page.getByRole('button', { name: 'Edit connection', exact: true }).click()
  await page.getByLabel('Connection text', { exact: true }).fill('New service text')
  await page.getByRole('button', { name: 'Close connection settings', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit connection', exact: true })).toContainText('New service text')
  await expect(page.getByRole('button', { name: 'Edit connection', exact: true })).toContainText('10.10.0.10/24')
  await page.locator('[data-id="annotation"] .vue-flow__edge-textwrapper').click()
  await page.getByLabel('Connection text', { exact: true }).fill('New review text')
  await expect(page.getByRole('region', { name: 'Connection', exact: true })).not.toContainText('Interface Name')
  await page.getByRole('button', { name: 'Close connection settings', exact: true }).click()
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await page.reload()
  await expect(page.getByText('New review text', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit connection', exact: true })).toContainText('New service text')
  expect(api.state.writes).toEqual([])
})
