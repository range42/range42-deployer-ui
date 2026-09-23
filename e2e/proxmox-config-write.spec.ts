import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalStorage, setupMockApi } from './fixtures/mockApi'

for (const width of [1280, 390]) {
  test(`reviewed configuration writes keep pending resources separate at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 })
    await seedLocalStorage(page, { migrationDone: true, projects: [{ id: 'config-write', name: 'Config write', edges: [], nodes: [{
      id: 'guest-142', type: 'vm', position: { x: 100, y: 100 }, data: {
        deployed: true, vmId: 142, name: 'Observed', label: 'Observed', status: 'running',
        config: { name: 'Observed', cores: 2, memory: 1024, proxmoxNode: 'pve-b' },
        actualConfig: { name: 'Observed', cores: 2, memory: 1024, tags: [], description: '' },
        desiredConfig: { name: 'Wanted', cores: 4, memory: 2048, tags: ['wanted'], description: '' },
      },
    }] }] })
    await page.addInitScript(() => {
      document.cookie = 'range42.settings.config-write=' + encodeURIComponent(JSON.stringify({ backendApiUrl: location.origin, proxmoxNode: 'pve-b' })) + '; path=/'
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', label: 'Fixture', url: location.origin, nodeName: 'pve-b' }], activeHostId: 'backend', seeded: true }))
    })
    await setupMockApi(page)
    const writes: Array<{ path: string; body: unknown }> = [], polls: string[] = []
    let applied = false
    const current = { name: 'Observed', cores: 2, memory: 1024, tags: '', description: '' }
    const wanted = { name: 'Wanted', cores: 4, memory: 2048, tags: 'wanted', description: '' }
    await page.route(/\/v1\/proxmox\/hosts(?:[/?]|$)/, async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (path.endsWith('/hosts')) return route.fulfill({ json: { offset: 0, total: 2, items: [{ id: 'wrong', node_name: 'pve-a' }, { id: 'selected', node_name: 'pve-b' }] } })
      expect(path).toContain('/hosts/selected/')
      if (request.method() === 'PUT') {
        writes.push({ path, body: request.postDataJSON() }); applied = true
        return route.fulfill({ json: { status: 'accepted', upid: 'UPID:pve-b:A:B:C:qmconfig:142:root@pam:', review: null } })
      }
      if (path.includes('/tasks/')) {
        polls.push(url.searchParams.get('expected_target_digest') || '')
        return route.fulfill({ json: { status: 'stopped', exitstatus: 'OK' } })
      }
      if (path.endsWith('/config/review')) return route.fulfill({ json: { host_id: 'selected', node: 'pve-b', vmid: 142, vmtype: 'qemu', digest: (applied ? 'b' : 'a').repeat(64), target_digest: 'c'.repeat(64),
        current: applied ? { ...current, name: 'Wanted', tags: 'wanted' } : current,
        configured: applied ? wanted : current, pending: applied ? ['cores', 'memory'] : [] } })
      return route.fulfill({ json: { items: [] } })
    })
    await page.goto('/project/config-write?tab=canvas&node=guest-142')
    await page.locator('.modal-open').getByRole('button', { name: 'Apply', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Apply Changes — Wanted' })
    await expect(dialog.getByRole('button', { name: 'Apply Changes', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Review changes', exact: true }).click()
    await expect(dialog.getByTestId('config-write-review')).toContainText('pve-b · qemu 142')
    await dialog.getByRole('button', { name: 'Apply Changes', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('Configuration verified in Proxmox')
    await expect(dialog).toContainText('Some changes remain pending')
    expect(writes).toEqual([{ path: '/v1/proxmox/hosts/selected/vms/142/config', body: { digest: 'a'.repeat(64), changes: { name: 'Wanted', cores: 4, memory: 2048, tags: 'wanted' } } }])
    expect(polls).toEqual(['c'.repeat(64)])
    await expect(dialog.getByRole('button', { name: 'Apply Changes', exact: true })).toBeDisabled()
    expect(await dialog.locator('.modal-box').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="apply-changes-title"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`configuration-review-${width}.png`), fullPage: true })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).not.toBeVisible()
  })
}
