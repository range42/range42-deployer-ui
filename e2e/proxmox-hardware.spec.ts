import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalStorage, setupMockApi } from './fixtures/mockApi'

for (const width of [1280, 390]) {
  test(`imported NIC and disk edits require review and verified readback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    await seedLocalStorage(page, { migrationDone: true, projects: [{ id: 'hardware', name: 'Hardware', edges: [], nodes: [{
      id: 'guest', type: 'vm', position: { x: 100, y: 100 }, data: { deployed: true, vmId: 60001, label: 'Imported', status: 'stopped',
        config: { name: 'Imported', cores: 2, memory: 2048, proxmoxNode: 'pve-b', proxmoxHostId: 'selected' },
        actualConfig: { name: 'Imported', cores: 2, memory: 2048, tags: [], description: '' },
        desiredConfig: { name: 'Imported', cores: 2, memory: 2048, tags: [], description: '' } },
    }] }] })
    await page.addInitScript(() => {
      document.cookie = 'range42.settings.hardware=' + encodeURIComponent(JSON.stringify({ backendApiUrl: location.origin, proxmoxNode: 'pve-b' })) + '; path=/'
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', label: 'Fixture', url: location.origin, nodeName: 'pve-b' }], activeHostId: 'backend', seeded: true }))
    })
    await setupMockApi(page)
    const writes: Array<{ path: string; body: unknown }> = [], polls: string[] = []
    const initial = { nics: [{ id: 'net0', model: 'virtio', mac: '52:54:00:00:00:01', bridge: 'vmbr0', tag: 5, firewall: false, link_down: false, editable: true }],
      disks: [{ id: 'scsi0', size_bytes: 16 * 1024 ** 3, pool: 'local-lvm', volume_fingerprint: 'e'.repeat(64), editable: true }] }
    const current = structuredClone(initial), configured = structuredClone(initial)
    let digest = 'a'
    await page.route(/\/v1\/proxmox\/hosts(?:[/?]|$)/, async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname
      if (path.endsWith('/hosts')) return route.fulfill({ json: { offset: 0, total: 2, items: [{ id: 'other', node_name: 'pve-a' }, { id: 'selected', node_name: 'pve-b' }] } })
      expect(path).toContain('/hosts/selected/')
      if (req.method() === 'PUT') {
        const body = req.postDataJSON()
        writes.push({ path, body })
        expect(body.digest).toBe(digest.repeat(64))
        if (path.endsWith('/nics/net0')) { expect(body.changes).toEqual({ bridge: 'vmbr1' }); configured.nics[0].bridge = 'vmbr1'; digest = 'b' }
        else { expect(path.endsWith('/disks/scsi0/grow')).toBe(true); expect(body.size_gb).toBe(24); configured.disks[0].size_bytes = current.disks[0].size_bytes = 24 * 1024 ** 3; digest = 'c' }
        return route.fulfill({ json: { status: 'accepted', upid: `UPID:pve-b:A:B:C:${path.includes('/nics/') ? 'qmconfig' : 'resize'}:60001:user@pam:`, review: null } })
      }
      expect(req.method()).toBe('GET')
      if (path.includes('/tasks/')) { polls.push(url.searchParams.get('expected_target_digest') || ''); return route.fulfill({ json: { status: 'stopped', exitstatus: 'OK' } }) }
      if (path.endsWith('/hardware/review')) return route.fulfill({ json: { host_id: 'selected', node: 'pve-b', vmid: 60001, vmtype: 'qemu', digest: digest.repeat(64), target_digest: 'd'.repeat(64), current, configured, pending: digest === 'a' ? [] : ['net0'] } })
      if (path.endsWith('/status')) return route.fulfill({ json: { vmid: 60001, node: 'pve-b', type: 'qemu', status: 'stopped' } })
      return route.fulfill({ json: { items: [] } })
    })
    await page.goto('/project/hardware?tab=canvas&node=guest')
    await page.getByRole('button', { name: 'Review NICs and disks', exact: true }).click({ timeout: 5000 })
    const dialog = page.getByRole('dialog', { name: 'Existing guest hardware' })
    await expect(dialog.getByTestId('hardware-bridge')).toHaveValue('vmbr0')
    await dialog.getByTestId('hardware-bridge').fill('vmbr1')
    expect(writes).toHaveLength(0)
    await dialog.getByTestId('hardware-review').click()
    await expect(dialog.getByTestId('hardware-comparison')).toContainText('vmbr0 → vmbr1')
    await dialog.getByTestId('hardware-apply').click()
    await expect(dialog.getByRole('status')).toContainText('pending Proxmox changes')
    await dialog.getByTestId('hardware-kind').selectOption('disk')
    await dialog.getByTestId('hardware-size').fill('24')
    await dialog.getByTestId('hardware-review').click()
    await expect(dialog.getByTestId('hardware-comparison')).toContainText('16 GiB → 24 GiB')
    await dialog.getByTestId('hardware-apply').click()
    await expect(dialog.getByRole('status')).toContainText('filesystem')
    expect(writes).toHaveLength(2)
    expect(polls).toEqual(['d'.repeat(64), 'd'.repeat(64)])
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="hardware-title"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).not.toBeVisible()
  })
}
