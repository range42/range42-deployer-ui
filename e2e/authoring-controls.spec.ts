import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { routeApi } from './fixtures/routeApi'

for (const width of [1440, 390]) {
  test(`access readback and explicit SDN scenario review at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 })
    const project = { id: 'sdn-review', name: 'Local network review', files: {}, edges: [{ id: 'edge', source: 'vm', target: 'net' }], nodes: [
      { id: 'vm', type: 'vm', position: { x: 100, y: 100 }, data: { label: 'guest', config: { name: 'guest', template: 9901 } } },
      { id: 'net', type: 'network-segment', position: { x: 400, y: 100 }, data: { config: {} } },
    ], scenario: { label: 'demo', network_mode: 'sdn', zone: 'r42lab',
      networks: [{ id: 'net', vnet: 'r42net1', subnet: '10.42.1.0/24', gateway: '10.42.1.1', snat: true }],
      vms: [{ node_id: 'vm', vm_id: 3101, vm_name: 'guest', template_vm_id: 9901, network_id: 'net', ip: '10.42.1.10', ssh_user: 'alice' }], content: [] } }
    const api = await routeApi(page, [project]), reads: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route(/\/v1\/(?:auth\/me|admin\/audit|proxmox\/hosts)(?:[/?]|$)/, async route => {
      expect(route.request().method()).toBe('GET')
      const url = new URL(route.request().url()), path = url.pathname
      reads.push(path)
      const items = path.endsWith('/hosts') ? [{ id: 'host', name: 'Reviewed host', node_name: 'pve01' }]
        : path.endsWith('/zones') ? [
          { zone: 'training', type: 'simple', nodes: ['pve01'], state: null, has_pending: false },
          { zone: 'pending', type: 'simple', nodes: [], state: 'changed', has_pending: true },
          { zone: 'foreign', type: 'simple', nodes: ['pve02'], state: null, has_pending: false },
        ] : path.endsWith('/vnets') ? [{ vnet: 'labnet', zone: 'training', state: null, has_pending: false }]
          : path.endsWith('/subnets') ? [{ subnet: 'training-10.42.1.0-24', vnet: 'labnet', cidr: '10.42.1.0/24', gateway: '10.42.1.1', snat: false, state: null, has_pending: false }] : null
      if (path === '/v1/auth/me') return route.fulfill({ json: { actor_id: 'review-operator', role: 'admin', scope: 'installation', audit_enabled: true } })
      if (path === '/v1/admin/audit') return route.fulfill({ json: { items: [{ id: 'audit', actor_id: 'review-operator', role: 'operator', method: 'PUT', route: '/v1/proxmox/hosts/{host}/vms/{vmid}/config', state: 'completed', status_code: 200, created_at: '2026-09-14T12:00:00Z' }], total: 1 } })
      if (items) return route.fulfill({ json: { items, total: items.length, offset: 0, limit: 100,
        ...(path.includes('/sdn/') ? { view: 'pending', visibility: 'credential_filtered' } : {}) } })
      return route.fallback()
    })
    await page.goto('/settings')
    const access = page.getByTestId('backend-access-panel')
    expect(reads).not.toContain('/v1/auth/me')
    await access.getByTestId('check-access').click()
    await expect(access).toContainText('review-operator')
    await expect(access).toContainText('Administrator access')
    await access.getByTestId('load-audit').click()
    await expect(access.getByTestId('audit-row')).toHaveCount(1)
    await expect(access).toContainText('does not prove guest execution succeeded')
    await expect(page.getByTestId('retention-inactive')).toHaveText('Not enforced')
    await access.screenshot({ path: testInfo.outputPath(`backend-access-${width}.png`) })

    await page.goto('/project/sdn-review?tab=config')
    await page.getByTestId('project-scenario').click()
    await expect.poll(() => page.getByRole('dialog').evaluate(element => element.contains(document.activeElement))).toBe(true)
    const picker = page.getByTestId('sdn-inventory-picker')
    await picker.locator('summary').click()
    expect(reads.some(path => path.includes('/sdn/'))).toBe(false)
    await picker.getByTestId('sdn-load').click()
    await picker.locator('[name="sdn-host"]').selectOption('host')
    await expect(picker.locator('[name="sdn-zone"] option[value="pending"]')).toHaveAttribute('disabled', '')
    await expect(picker.locator('[name="sdn-zone"] option[value="foreign"]')).toHaveAttribute('disabled', '')
    await picker.locator('[name="sdn-zone"]').selectOption('training')
    await picker.locator('[name="sdn-vnet"]').selectOption('labnet')
    await picker.locator('[name="sdn-subnet"]').selectOption('training-10.42.1.0-24')
    await picker.locator('[name="sdn-draft-network"]').selectOption('net')
    expect((await new AxeBuilder({ page }).include('[data-testid="sdn-inventory-picker"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await picker.screenshot({ path: testInfo.outputPath(`sdn-review-${width}.png`) })
    await picker.getByTestId('sdn-use').click()
    const savedScenario = () => page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]')[0].scenario)
    expect(await savedScenario()).toEqual(project.scenario)
    await page.getByTestId('scenario-vm-storage').fill('fast-pool')
    await page.getByTestId('scenario-vm-ssh-user').fill('operator')
    await page.getByTestId('scenario-vm-dns').fill('10.42.1.2, 1.1.1.1')
    await page.getByTestId('scenario-vm-domain').fill('lab.example')
    await page.getByTestId('scenario-review').click()
    await expect(page.getByTestId('scenario-apply')).toBeVisible()
    expect(await savedScenario()).toEqual(project.scenario)
    await page.getByTestId('scenario-apply').click()
    await expect(page.getByTestId('scenario-apply')).toHaveCount(0)
    const saved = await savedScenario()
    expect(saved).toMatchObject({ zone: 'training', networks: [{ id: 'net', vnet: 'labnet', snat: false }], vms: [{ storage: 'fast-pool', ssh_user: 'operator', dns_servers: '10.42.1.2, 1.1.1.1', dns_search_domain: 'lab.example' }] })
    const manifest = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('range42_projects') || '[]')[0].files['scenarios/demo/manifest/scenario_vms.json']))
    expect(manifest.vms[0].cloud_init).toEqual({ ssh_user: 'operator', dns_servers: ['10.42.1.2', '1.1.1.1'], dns_search_domain: 'lab.example' })
    await page.reload()
    expect(await savedScenario()).toEqual(saved)
    expect(api.state.writes).toEqual([])
    expect(api.state.unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`catalog machine role and Compose authoring remain reviewed drafts at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 })
    const api = await routeApi(page), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/catalog')
    await page.getByTestId('new-catalog-machine').click()
    let dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await dialog.locator('[name="category"]').focus()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.locator('[name="category"]')).toBeFocused()
    await dialog.locator('[name="target"]').fill('web')
    await dialog.locator('[name="description"]').fill('Portable training VM')
    await dialog.locator('[name="os"]').fill('Ubuntu Noble')
    await dialog.getByRole('button', { name: 'Preview files', exact: true }).click()
    await expect(dialog.getByTestId('machine-continue')).toBeVisible()
    await expect(dialog.getByTestId('machine-file-preview').filter({ hasText: '/range42.yaml' })).toContainText('kind: vm')
    await expect(dialog).toContainText('blank inherits template storage')
    await dialog.screenshot({ path: testInfo.outputPath(`machine-draft-${width}.png`) })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('new-catalog-machine').click()
    await expect(page.getByRole('dialog').locator('[name="target"]')).toHaveValue('')
    await expect.poll(() => page.getByRole('dialog').evaluate(element => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('new-catalog-role').click()
    dialog = page.getByRole('dialog')
    await expect(dialog.locator('[name="target"]')).toBeFocused()
    await dialog.locator('[name="target"]').fill('training')
    await dialog.locator('[name="description"]').fill('Review local role files')
    await dialog.locator('[name="tasks"]').fill('- name: Explain the exercise\n  ansible.builtin.debug:\n    msg: reviewed\n')
    await dialog.getByRole('button', { name: 'Preview files', exact: true }).click()
    await expect(dialog.getByTestId('role-continue')).toBeVisible()
    await expect(dialog.getByTestId('role-file-preview').filter({ hasText: '/tasks/main.yml' })).toContainText('ansible.builtin.debug')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByTestId('new-catalog-container').click()
    dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await dialog.locator('[name="target"]').focus()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.locator('[name="target"]')).toBeFocused()
    await dialog.locator('[name="target"]').fill('training-web')
    await dialog.locator('[name="description"]').fill('One reviewed Compose service')
    await dialog.getByRole('button', { name: 'Preview files', exact: true }).click()
    await expect(dialog.getByTestId('container-continue')).toBeVisible()
    await expect(dialog.getByTestId('container-file-preview').filter({ hasText: '/compose.yml' })).toContainText('nginx:alpine')
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="new-container-title"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await dialog.screenshot({ path: testInfo.outputPath(`compose-draft-${width}.png`) })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(api.state.writes).toEqual([])
    expect(api.state.unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
