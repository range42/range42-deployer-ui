import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { routeApi } from './fixtures/routeApi'

for (const [existing, width] of [[false, 1440], [true, 1440], [false, 390]] as const) {
  test(`adds the existing native scenario beside existing=${existing} at ${width}px`, async ({ page }) => {
    const entry = process.env.R42_NATIVE_SCENARIO_FIXTURE ? JSON.parse(readFileSync(process.env.R42_NATIVE_SCENARIO_FIXTURE, 'utf8')) : {
      source_id: 'catalog', path: 'scenarios/demo', kind: 'scenario', name: 'demo', sha: 'a'.repeat(40), document: {
        format: 'range42-native', topology: { vms: [{ vm_id: 2001, vm_name: 'web', ip: '10.42.0.10', bridge: 'net42' }],
          templates: [], networks: [{ vnet: 'net42', subnet: '10.42.0.0/24' }], warnings: ['Diagram includes optional resources.'], reservations: { status: 'checked', issues: [] } },
      },
    }
    const api = await routeApi(page, [{ id: 'native-project', name: 'My project', attachments: [], head_sha: 'a'.repeat(40),
      nodes: existing ? [{ id: 'keep', type: 'vm', position: { x: 0, y: 0 }, data: { config: { name: 'Keep this VM', vmid: 3000 } } }] : [],
      edges: [], files: { 'notes.txt': 'Keep these bytes' } }])
    api.state.catalog = [entry]
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.route('**/v1/contexts', route => route.fulfill({ json: { items: [] } }))
    await page.route('**/v1/projects/*/native-scenario?*', route => {
      expect(new URL(route.request().url()).searchParams.get('component_id')).toBe('catalog-1')
      return route.fulfill({ json: { features: [], topology: entry.document.topology } })
    })
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/project/native-project')
    if (width < 1024) await page.getByRole('button', { name: 'Project tools', exact: true }).click()
    await page.getByTestId('add-native-scenario').filter({ visible: true }).click()
    await expect(page).toHaveURL(/kind=scenario/)
    await page.getByTestId('catalog-add-to-project').click()
    await page.getByTestId('catalog-append-review').click()
    await expect(page.getByTestId('catalog-append-error')).toHaveCount(0)
    await page.getByTestId('catalog-append-open').click()
    const group = page.locator('.vue-flow__node-group[data-id="catalog-1"]')
    await expect(group).toBeVisible()
    await expect(group).not.toContainText('Drop components here')
    await expect(page.locator('.vue-flow__node-vm')).toHaveCount(entry.document.topology.vms.length + Number(existing))
    await expect(page.locator('.vue-flow__node-network-segment')).toHaveCount(entry.document.topology.networks.length)
    await page.reload()
    await expect(group).toBeVisible()
    await expect(page.locator('.vue-flow__edge-network')).toHaveCount(entry.document.topology.vms.filter((vm: { bridge?: string }) => vm.bridge).length)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0])
    expect(saved.files).toEqual({ 'notes.txt': 'Keep these bytes' })
    expect(saved.nodes.find((node: { id: string }) => node.id === 'catalog-1').data.config.nativeCatalog.sha).toBe(entry.sha)
    await page.getByRole('button', { name: 'Close configuration panel', exact: true }).click()
    if (process.env.R42_NATIVE_SCREENSHOTS) await page.screenshot({ path: `${process.env.R42_NATIVE_SCREENSHOTS}/native-${width}-${existing}.png` })
    await group.getByRole('button', { name: 'Deploy scenario' }).click()
    await expect(page.getByTestId('deploy-form')).toBeVisible()
    await expect(page.getByTestId('native-context-empty')).toBeVisible()
    expect(errors).toEqual([])
    expect(api.state.writes).toEqual([])
  })
}
