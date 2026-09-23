import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalStorage, setupMockApi } from './fixtures/mockApi'

for (const width of [1280, 390]) {
  test(`snapshot-set review and read-only reconciliation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 })
    await seedLocalStorage(page, { migrationDone: true })
    await page.addInitScript(() => {
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', label: 'Fixture', url: location.origin, token: 'fixture-only-token' }], activeHostId: 'backend', seeded: true }))
    })
    await setupMockApi(page)
    const member = { vm_id: 60000, vm_name: 'training-guest', uuid: '00000000-0000-4000-8000-000000000001', status: 'stopped', config_digest: 'c'.repeat(64), restore_digest: 'd'.repeat(64) }
    const item = { id: 'a'.repeat(32), deployment_id: 'dep', project_sha: 'a'.repeat(40), host_id: 'host', target_digest: 'b'.repeat(64), name: 'Checkpoint', description: '', native_name: 'r42s_' + 'a'.repeat(24),
      state: 'planned', atomic: false, vmstate: false, created_at: '2026-09-14T12:00:00Z', members: [member],
      operation: { id: 'b'.repeat(32), kind: 'create', state: 'planned', recovery: 'none', plan_digest: 'e'.repeat(64), expires_at: new Date(Date.now() + 300000).toISOString(), reviewed_members: [member], members: [{ vm_id: 60000, state: 'planned' }] } }
    const mutations: unknown[] = [], reconciliations: string[] = []
    let saved = false
    await page.route(/\/v1\/deployments\/dep(?:[/?]|$)/, async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path.endsWith('/snapshot-sets/plan')) { saved = true; return route.fulfill({ status: 201, json: item }) }
      if (path.endsWith('/execute')) {
        mutations.push(request.postDataJSON()); item.state = 'creating'; item.operation.state = 'running'; item.operation.recovery = 'poll_saved_tasks'; item.operation.members[0].state = 'accepted'
        return route.fulfill({ status: 202, json: item })
      }
      if (path.endsWith('/reconcile')) {
        reconciliations.push(path); item.state = 'complete'; item.operation.state = 'succeeded'; item.operation.recovery = 'none'; item.operation.members[0].state = 'succeeded'
        return route.fulfill({ json: item })
      }
      expect(request.method()).toBe('GET')
      if (path.endsWith('/snapshot-sets')) return route.fulfill({ json: { items: saved ? [item] : [], total: saved ? 1 : 0, offset: 0, limit: 20 } })
      if (path.endsWith('/allocations')) return route.fulfill({ status: 404, json: { code: 'ALLOCATION_NOT_FOUND' } })
      if (path.endsWith('/runtime')) return route.fulfill({ json: { vms: [], runtime: { available: false, operations: [] }, sdn: { networks: [] } } })
      if (path === '/v1/deployments/dep') return route.fulfill({ json: { id: 'dep', codename: 'SNAPSHOT_FIXTURE', project_id: 'project', target_host_id: 'host', project_sha: 'a'.repeat(40), scenario_label: 'exercise', state: item.operation.state === 'running' ? 'deploying' : 'succeeded', team_count: 1 } })
      return route.fulfill({ json: { items: [], total: 0 } })
    })
    await page.goto('/deployments/dep?tab=overview')
    const panel = page.getByTestId('snapshot-sets')
    await expect(panel).toBeVisible()
    await panel.getByTestId('snapshot-plan-create').click()
    await expect(panel.getByTestId('snapshot-review')).toContainText('60000')
    expect(mutations).toHaveLength(0)
    expect(reconciliations).toHaveLength(0)
    expect((await new AxeBuilder({ page }).include('[data-testid="snapshot-sets"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await panel.getByTestId('snapshot-review').screenshot({ path: testInfo.outputPath(`snapshot-review-${width}.png`) })
    await panel.getByTestId('snapshot-confirm').click()
    await expect(panel.getByTestId('snapshot-record')).toContainText('Running')
    expect(mutations).toEqual([{ plan_digest: 'e'.repeat(64) }])
    expect(reconciliations).toHaveLength(0)
    await panel.getByTestId('snapshot-reconcile').click()
    await expect(panel.getByTestId('snapshot-record')).toContainText('Succeeded')
    expect(reconciliations).toHaveLength(1)
    expect(mutations).toHaveLength(1)
  })
}
