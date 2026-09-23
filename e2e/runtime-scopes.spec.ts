import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { routeApi } from './fixtures/routeApi'

for (const width of [1280, 390]) {
  test(`scoped runtime report and reviewed policy at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 })
    await routeApi(page)
    const network = { vnet: 'r42blue', zone: 'r42lab', subnet: '10.42.70.0/24', gateway: '10.42.70.1',
      manifest_snat: true, configured_snat: false, identity_matches: true, active: true }
    const firewall = { datacenter_enabled: true, node_enabled: false, errors: [] }
    const sdn = { pending_changes: false, errors: [] }
    const rule = { position: 0, direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '443',
      source: '10.42.70.0/24', enabled: true, comment: 'range42-deployment:route-deployment;rule:web' }
    const state = { target_host_id: 'host', node_name: 'pve01', firewall, sdn, networks: [network],
      vms: [{ vm_id: 3191, status: 'owned', name: 'guest', nics: [], firewall_enabled: true }],
      permissions: { admin: true, operate: true }, runtime: { available: true, contract: 'native-sdn-20260921',
        operations: ['host_firewall', 'sdn_network', 'firewall_rule', 'firewall_alias', 'runtime_observe'] } }
    const writes: unknown[] = []
    let refuse = true
    await page.route(/\/v1\/deployments\/route-deployment\/(runtime(?:-report)?|operations(?:\/plan)?)$/, async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path.endsWith('/operations/plan')) {
        expect(request.method()).toBe('POST')
        if (refuse) return route.fulfill({ status: 409, json: { message: 'Configuration changed; review again.', code: 'RUNTIME_REVIEW_CHANGED' } })
        return route.fulfill({ json: { review_fingerprint: 'd'.repeat(64), target_host_id: 'host', target_identity: { node_name: 'pve01' }, project_sha: 'b'.repeat(40), plan: { scope: 'vm' } } })
      }
      if (path.endsWith('/operations')) {
        writes.push(request.postDataJSON())
        return route.fulfill({ status: 201, json: { id: 'policy-attempt', state: 'pending', scope: 'runtime' } })
      }
      expect(request.method()).toBe('GET')
      return route.fulfill({ json: path.endsWith('/runtime') ? state : {
        version: 1, partial: true, observed_at: '2026-09-22T12:00:00Z', traffic_verified: false, switches: firewall, sdn,
        networks: [network], cards: [{ vm_id: 3191, index: 0, bridge: 'r42blue', filtering_configured: null, reasons: ['guest_unknown'] }],
        chains: [{ scope: 'datacenter', available: false, error: 'Permission missing', rules: [], aliases: [] },
          { scope: 'vm', vm_id: 3191, available: true, rules: [rule], aliases: [] }], live_nat: { available: false, rules: [] },
      } })
    })
    await page.goto('/deployments/route-deployment?tab=overview')
    const panel = page.getByTestId('runtime-controls')
    await panel.getByTestId('runtime-report-open').click()
    await expect(panel).toContainText('Permission missing')
    await expect(panel.getByTestId('reported-network-r42blue')).toContainText('10.42.70.0/24')
    await panel.getByTestId('policy-edit-vm-3191-0').click()
    await panel.getByTestId('policy-port').fill('8443')
    await panel.getByTestId('policy-rule-form').getByRole('button', { name: 'Review change' }).click()
    await expect(panel).toContainText('Configuration changed; review again.')
    await expect(panel.getByTestId('policy-port')).toHaveValue('8443')
    await expect(panel.getByTestId('runtime-apply')).toHaveCount(0)
    expect(writes).toEqual([])
    refuse = false
    await panel.getByTestId('policy-rule-form').getByRole('button', { name: 'Review change' }).click()
    await expect(panel).toContainText('pve01')
    await panel.getByTestId('runtime-shared-ack').check()
    await expect(panel.getByTestId('runtime-apply')).toBeEnabled()
    expect((await new AxeBuilder({ page }).include('[data-testid="runtime-controls"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await panel.screenshot({ path: testInfo.outputPath(`runtime-scope-${width}.png`) })
    await panel.getByTestId('runtime-apply').click()
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0]).toMatchObject({ kind: 'firewall_rule', action: 'update', scope: 'vm', vm_id: 3191, position: 0,
      acknowledge_shared_scope: true, review_fingerprint: 'd'.repeat(64), rule: { destination_port: '8443', source: '10.42.70.0/24' } })
  })
}
