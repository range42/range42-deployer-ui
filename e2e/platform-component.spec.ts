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
    await page.route('**/v1/proxmox/hosts?*', route => route.fulfill({ json: { items: [{ id: 'host', name: 'PVE', node_name: 'pve01' }], total: 1, offset: 0, limit: 100 } }))
    await page.route('**/v1/proxmox/hosts/host/vms', route => route.fulfill({ json: { items: [{ vmid: 9221, name: 'Ubuntu template', type: 'qemu', template: true, node: 'pve01' }], total: 1 } }))
    await page.route('**/v1/proxmox/hosts/host/sdn/vnets?*', route => route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 100, view: 'pending', visibility: 'credential_filtered' } }))
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
    await expect(dialog.locator('select[name=template_vmid]')).toHaveValue('9221')
    await dialog.locator('[name=profile]').selectOption(component.plan.profile)
    for (const [name, value] of Object.entries({ id: 'alpha', domain: 'alpha.example.test', vmid_start: '31000', subnet: '10.81.0.0/24', gateway: '10.81.0.1', bridge: 'r42alpha' })) await dialog.locator(`[name="${name}"]`).fill(value)
    await page.getByTestId('platform-review').click()
    await expect.poll(() => previews).toBe(1)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await page.getByTestId('platform-add').click()
    const node = page.locator('.vue-flow__node-group[data-id="platform-alpha"]')
    await expect(node).toBeVisible()
    await expect(node).toContainText('alpha.example.test')
    await expect(page.locator('.vue-flow__node-vm[data-id^="platform-alpha-"] .infra-node')).toHaveCount(component.plan.vms.length)
    await expect(page.locator('.vue-flow__node-network-segment .network-segment-node')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0].nodes.length)).toBe(component.plan.vms.length + 2 + Number(existing))
    await page.reload()
    await expect(node).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0].files['notes.txt'])).toBe('Keep these bytes')
    if (existing) await expect(page.locator('.vue-flow__node-vm[data-id=keep] .infra-node')).toBeVisible()
    await expect(page.locator('.vue-flow__edge-network')).toHaveCount(component.plan.vms.length)
    await expect(node.locator('.group-container')).toBeVisible()
    await expect(node).not.toContainText('Drop components here')
    await expect(page.locator('.network-footer')).toContainText(`${component.plan.vms.length}`)
    if (process.env.R42_STACK_SCREENSHOTS) await page.screenshot({ path: `${process.env.R42_STACK_SCREENSHOTS}/layout-${width}-${existing}.png` })
    const overlaps = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.vue-flow__node-vm .infra-node')].map(el => el.getBoundingClientRect())
      return [...document.querySelectorAll('.edge-label')].filter(el => {
        const label = el.getBoundingClientRect()
        return cards.some(card => Math.min(label.right, card.right) - Math.max(label.left, card.left) > 2 && Math.min(label.bottom, card.bottom) - Math.max(label.top, card.top) > 2)
      }).length
    })
    expect(overlaps).toBe(0)
    const vm = page.locator('.vue-flow__node-vm[data-id^="platform-alpha-"]').first()
    await vm.locator('.node-header').click()
    await expect(page.getByTestId('stack-resource-files')).toBeVisible()
    await page.getByTestId('stack-resource-files').click()
    await expect(page.getByTestId('tab-config')).toBeVisible()
    await page.getByTestId('project-tab-canvas').click()
    if (process.env.R42_STACK_SCREENSHOTS) await page.screenshot({ path: `${process.env.R42_STACK_SCREENSHOTS}/standard-stack-${width}-${existing}.png` })
    if (process.env.R42_PLATFORM_COMPONENT_FIXTURE) {
      await node.getByRole('button', { name: 'Stack files' }).click()
      const tree = page.getByTestId('file-tree-list')
      await expect(tree.locator('[data-folder="platform_runtime"] button')).toHaveAttribute('aria-expanded', 'false')
      await expect(tree.locator('[data-path="platforms/alpha/manifest/stack.json"]')).toBeVisible()
      await tree.locator('[data-folder="platforms"] button').click()
      await expect(tree.locator('[data-path="platforms/alpha/manifest/stack.json"]')).toHaveCount(0)
      await page.getByTestId('project-tab-canvas').click()
    }
    await node.getByRole('button', { name: 'Deploy stack' }).click()
    await expect(page.getByTestId('deploy-form')).toBeVisible()
    await expect(page.getByTestId('deploy-form')).toContainText('Range42 platform')
    expect(api.state.writes).toEqual([])
    expect(errors).toEqual([])
  })
}
