import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'
import { replicatedScenario } from '../src/__tests__/fixtures/replicatedScenario'

interface ReservationRequest {
  vms: Array<{ node_id: string; nics: Array<{ index: number; nic_key: string; network_id: string }> }>
  networks: Array<{ network_id: string; bridge: string; subnet: string; gateway: string; reserved_ips?: string[] }>
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`replicated allocation preserves authoring and reopens at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const input = replicatedScenario()
    for (const assigned of Object.values(input.scenario.replication.vm_assignments)) {
      assigned.vm_id = ''
      assigned.nics['nic-primary'].ip = ''
    }
    const project = { id: 'replication-browser', name: 'Replication browser', ...input,
      nodes: input.nodes.map((node, index) => ({ ...node, position: { x: 80 + index * 250, y: 80 } })) }
    await page.addInitScript(data => {
      if (localStorage.getItem('replication-test-seeded')) return
      localStorage.setItem('range42_projects', JSON.stringify([data]))
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({
        hosts: [{ id: 'browser-backend', url: location.origin, token: 'browser-fixture-token', label: 'Browser fixture' }],
        activeHostId: 'browser-backend', seeded: true,
      }))
      localStorage.setItem('replication-test-seeded', '1')
    }, project)
    await setupMockApi(page)
    await page.route(/\/v1\/proxmox\/hosts\?/, route => route.fulfill({ json: {
      items: [{ id: 'pve-mock-01', name: 'Browser target', node_name: 'pve-mock-01' }], total: 1,
    } }))
    const requests: ReservationRequest[] = []
    let reservation: Record<string, unknown>
    await page.route(/\/v1\/proxmox\/hosts\/pve-mock-01\/reservations(?:\/[^/?]+)?$/, async route => {
      if (route.request().method() === 'POST') {
        expect(route.request().headers().authorization).toBe('Bearer browser-fixture-token')
        expect(route.request().headers()['x-range42-reservation-token']).toMatch(/^[a-f0-9]{64}$/)
        const body: ReservationRequest = route.request().postDataJSON()
        requests.push(body)
        reservation = { reservation_id: 'browser-lease', project_key: project.id, host_id: 'pve-mock-01', node_name: 'pve-mock-01',
          checked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(), limitations: [],
          assignments: body.vms.map((vm, index) => ({ node_id: vm.node_id, vm_id: 4101 + index,
            nics: vm.nics.map(nic => {
              const network = body.networks.find(network => network.network_id === nic.network_id)!
              return { ...nic, bridge: network.bridge, subnet: network.subnet, gateway: network.gateway, prefix: 24,
                ip: network.subnet.split('.').slice(0, 3).join('.') + `.${20 + index}` }
            }) })) }
      }
      await route.fulfill({ json: reservation })
    })
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(`/project/${project.id}`)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(page.url()).hostname) && page.url().startsWith('http:')) {
      expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
    }
    await expect(page.getByTestId('canvas-wrapper')).toBeVisible()
    await page.getByTestId('project-scenario').click()
    const dialog = page.getByRole('dialog', { name: 'Configure executable scenario' })
    await expect(dialog.getByTestId('replication-counts')).toHaveText('3 VMs · 2 networks · 3 NICs')
    await dialog.getByTestId('replication-reserved-ips').first().fill('10.42.10.50')
    await dialog.getByTestId('replication-reserved-ips').first().press('Tab')
    await expect(dialog.getByTestId('allocation-reserve')).toBeEnabled()
    await dialog.getByTestId('allocation-reserve').click()
    await expect(dialog.getByTestId('allocation-apply')).toBeEnabled()
    expect(requests).toHaveLength(1)
    expect(requests[0].vms).toHaveLength(3)
    expect(requests[0].networks).toHaveLength(2)
    expect(requests[0].networks[0].reserved_ips).toEqual(['10.42.10.50'])
    expect(requests[0].vms.every(vm => vm.node_id.startsWith('vm-') && vm.nics.length === 1 && vm.nics[0].nic_key === 'nic-primary')).toBe(true)
    await dialog.getByTestId('replication-reserved-ips').first().fill('10.42.10.20')
    await dialog.getByTestId('replication-reserved-ips').first().press('Tab')
    await expect(dialog.getByTestId('allocation-apply')).toBeDisabled()
    await dialog.getByTestId('replication-reserved-ips').first().fill('10.42.10.50')
    await dialog.getByTestId('replication-reserved-ips').first().press('Tab')
    await dialog.getByTestId('replication-user').first().getByRole('textbox', { name: 'User label' }).fill('Student A')
    await expect(dialog.getByTestId('allocation-apply')).toBeEnabled()
    await dialog.getByTestId('allocation-apply').click()
    await expect(dialog.getByTestId('replication-vmid').first()).toHaveValue('4101')
    const violations = (await new AxeBuilder({ page }).include('[aria-labelledby="scenario-authoring-title"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
    expect(await dialog.locator('.modal-box').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await dialog.getByTestId('replication-counts').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/r42-replication-${viewport.width}.png` })
    await dialog.getByTestId('scenario-review').click()
    await expect(dialog.getByTestId('scenario-apply')).toBeVisible()
    await dialog.getByTestId('scenario-apply').click()
    await expect(dialog).not.toBeVisible()
    const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('range42_projects') || '[]').find(project => project.id === id), project.id)
    expect(saved.nodes).toHaveLength(2)
    expect(saved.scenario.vms).toHaveLength(1)
    expect(saved.scenario.replication.teams).toHaveLength(2)
    const manifest = JSON.parse(saved.files['scenarios/replicated/manifest/scenario_instances.json'])
    expect(manifest.instances.map(vm => vm.vm_id)).toEqual([4101, 4102, 4103])
    expect(manifest.networks).toHaveLength(2)
    expect(JSON.stringify(saved.scenario)).not.toContain('browser-fixture-token')
    await page.reload()
    await page.getByTestId('project-scenario').click()
    await expect(dialog.getByTestId('replication-counts')).toHaveText('3 VMs · 2 networks · 3 NICs')
    await expect(dialog.getByTestId('replication-vmid').first()).toHaveValue('4101')
    await expect(dialog.getByTestId('replication-user').first().getByRole('textbox', { name: 'User label' })).toHaveValue('Student A')
    expect(requests).toHaveLength(1)
    expect(pageErrors).toEqual([])
  })
}
