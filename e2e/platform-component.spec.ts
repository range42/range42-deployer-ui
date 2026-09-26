import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { routeApi } from './fixtures/routeApi'

for (const [existing, width] of [[false, 1440], [true, 1440], [false, 390]] as const) {
  test(`adds and reopens a stack beside existing=${existing} canvas at ${width}px`, async ({ page }) => {
    const component = process.env.R42_PLATFORM_COMPONENT_FIXTURE
      ? JSON.parse(readFileSync(process.env.R42_PLATFORM_COMPONENT_FIXTURE, 'utf8'))
      : { version: 1, scenario: { version: 1, path: 'platforms/alpha' }, plan: { id: 'alpha', domain: 'alpha.example.test', profile: 'core', bridge: 'r42alpha', subnet: '10.81.0.0/24', vms: [{ service: 'ui', vm_id: 31000, vm_name: 'r42-alpha-ui' }] }, files: { 'platforms/alpha/main.yml': '- hosts: all\n  tasks: []\n' } }
    const project = { id: 'stack-project', name: 'Stack project', attachments: [], head_sha: 'a'.repeat(40),
      nodes: existing ? [{ id: 'keep', type: 'vm', position: { x: 0, y: 0 }, data: { config: { name: 'Keep this VM' } } }] : [], edges: [], files: { 'notes.txt': 'Keep these bytes' } }
    const api = await routeApi(page, [project])
    let previews = 0
    await page.route('**/v1/platform/components/preview', route => { previews++; return route.fulfill({ json: component }) })
    await page.route('**/v1/contexts', route => route.fulfill({ json: { items: [] } }))
    await page.route('**/v1/projects/*/native-scenario?*', route => route.fulfill({ json: { features: [], platform: {
      id: 'alpha', domain: 'alpha.example.test', profile: 'core', unavailable: { emp: 'preview', misp: 'unavailable' },
      presets: [{ id: 'core', features: {} }], parameters: [],
    } } }))
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/project/stack-project')
    if (width < 1024) await page.getByRole('button', { name: 'Project tools', exact: true }).click()
    await page.getByTestId('add-platform-stack').filter({ visible: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Range42 stack' })
    for (const [name, value] of Object.entries({ id: 'alpha', domain: 'alpha.example.test', vmid_start: '31000', template_vmid: '9221', subnet: '10.81.0.0/24', gateway: '10.81.0.1', bridge: 'r42alpha' })) await dialog.locator(`[name="${name}"]`).fill(value)
    await page.getByTestId('platform-review').click()
    await expect.poll(() => previews).toBe(1)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await page.getByTestId('platform-add').click()
    const node = page.getByTestId('platform-stack-node')
    await expect(node).toBeVisible()
    await expect(node).toContainText('alpha.example.test')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0].nodes.length)).toBe(existing ? 2 : 1)
    await page.reload()
    await expect(node).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0].files['notes.txt'])).toBe('Keep these bytes')
    if (existing) await expect(page.locator('.vue-flow__node-vm')).toHaveCount(1)
    await node.getByRole('button', { name: 'Deploy stack' }).click()
    await expect(page.getByTestId('deploy-form')).toBeVisible()
    await expect(page.getByTestId('deploy-form')).toContainText('Range42 platform')
    expect(api.state.writes).toEqual([])
    expect(errors).toEqual([])
  })
}
