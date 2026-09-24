import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { routeApi } from './fixtures/routeApi'
import { replicatedScenario } from '../src/__tests__/fixtures/replicatedScenario'

interface ReservationInput {
  project_key: string
  vms: Array<{ node_id: string; vm_id: number; nics: Array<{ index: number; nic_key: string; network_id: string; ip: string }> }>
  networks: Array<{ network_id: string; bridge: string; subnet: string; gateway?: string }>
}

test('saved SDN replicas prepare networks, deploy, change NAT, teardown and release their allocations', async ({ page }) => {
  const localId = 'local-happy', backendId = 'backend-happy', deploymentId = 'happy-deployment'
  const branch = 'range42-ui/happy', base = 'b'.repeat(40)
  const input = replicatedScenario()
  const project = { ...input, id: localId, name: 'Happy replicas',
    nodes: input.nodes.map((node, index) => ({ ...node, position: { x: 80 + index * 250, y: 80 } })),
    git: { source_id: 'catalog', provider: 'github', base_url: 'https://github.com', repo_owner: 'fixture', repo_name: 'work',
      branch: 'main', working_branch: branch, branch_from: base, subdir: '', branch_strategy: 'dedicated_repo', fork_policy: 'upstream' } }
  const api = await routeApi(page, [project])
  await page.addInitScript(({ localId, backendId }) => {
    const key = JSON.stringify([location.origin, localId, 'catalog', 'dedicated_repo', 'fixture', 'work', ''])
    localStorage.setItem('range42_project_registrations', JSON.stringify({ [key]: { id: backendId } }))
    localStorage.setItem(`range42_token_${encodeURIComponent(location.origin)}:catalog`, 'git-fixture-token')
  }, { localId, backendId })

  // An isolated in-memory GitHub repository. Every mutation remains inside this browser fixture.
  let head = base, revision = 1
  let lockReleased = false
  let files: Record<string, string> = {}, pending: Record<string, string> = {}
  const blob = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex')
  const gitWrites: string[] = [], unexpected: string[] = []
  await page.route('https://api.github.com/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = decodeURIComponent(url.pathname)
    const body = request.postData() ? request.postDataJSON() : null
    const method = request.method()
    if (method !== 'GET') gitWrites.push(`${method} ${path}`)
    if (path === '/repos/fixture/work' && method === 'GET') return route.fulfill({ json: { permissions: { push: true } } })
    if (path.endsWith('/commits') && method === 'GET') return route.fulfill({ json: [{ sha: url.searchParams.get('sha') === 'main' ? base : head, commit: { message: 'Fixture snapshot', author: {} } }] })
    if (path.includes('/git/ref/heads/')) return route.fulfill({ json: { object: { sha: path.endsWith('/main') ? base : head } } })
    if (path.includes('/contents/') && method === 'GET') {
      const file = path.split('/contents/')[1]
      return route.fulfill({ status: files[file] === undefined ? 404 : 200, json: files[file] === undefined ? { message: 'Not Found' }
        : { content: Buffer.from(files[file]).toString('base64'), encoding: 'base64', sha: blob(files[file]) } })
    }
    if (path === '/repos/fixture/work/contents/.lock' && method === 'PUT') {
      expect(body.branch).toBe(branch)
      expect(body.sha).toBe(blob(files['.lock']))
      const content = Buffer.from(body.content, 'base64').toString('utf8')
      expect(JSON.parse(content).released).toBe(true)
      files['.lock'] = content
      head = (++revision).toString(16).padStart(40, '0')
      lockReleased = true
      return route.fulfill({ json: { content: { sha: blob(content) }, commit: { sha: head } } })
    }
    if (path.endsWith('/git/refs') && method === 'POST') {
      expect(body.ref).toBe(`refs/heads/${branch}`)
      expect(body.sha).toBe(base)
      return route.fulfill({ status: 422, json: { message: 'Reference already exists' } })
    }
    if (path.includes('/git/commits/') && method === 'GET') return route.fulfill({ json: { tree: { sha: 'c'.repeat(40) } } })
    if (path.includes('/git/trees/') && method === 'GET') return route.fulfill({ json: {
      tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', sha: blob(content) })), truncated: false,
    } })
    if (path.endsWith('/git/trees') && method === 'POST') {
      pending = { ...files }
      for (const entry of body.tree) { expect(typeof entry.content).toBe('string'); pending[entry.path] = entry.content }
      return route.fulfill({ json: { sha: 'd'.repeat(40) } })
    }
    if (path.endsWith('/git/commits') && method === 'POST') {
      expect(body.parents).toEqual([head])
      return route.fulfill({ json: { sha: (++revision).toString(16).padStart(40, '0') } })
    }
    if (path === `/repos/fixture/work/git/refs/heads/${branch}` && method === 'PATCH') {
      expect(body.force).toBe(false)
      files = pending; head = body.sha
      return route.fulfill({ json: { object: { sha: head } } })
    }
    unexpected.push(`${method} ${path}`)
    return route.fulfill({ status: 405, json: { message: 'Unexpected provider fixture request.' } })
  })

  const writes: string[] = []
  let owner = '', lease: Record<string, unknown> | undefined
  let metadata = { id: deploymentId, project_id: backendId, project_sha: '', target_host_id: 'pve-happy', codename: 'HAPPY', scenario_label: 'replicated', state: 'pending', team_count: 1, current_attempt_id: '' }
  const attempts: Array<{ id: string; state: string; scope: string; operation?: unknown }> = []
  const createdNetworks = new Set<string>(), nat = new Map<string, boolean>()
  let guestsExist = false, allocationsReleased = false
  const networkManifest = () => JSON.parse(files['scenarios/replicated/manifest/scenario_networks.json'])
  const vmManifest = () => JSON.parse(files['scenarios/replicated/manifest/scenario_vms.json'])
  function startAttempt(scope: string, operation?: unknown) {
    const attempt = { id: `happy-attempt-${attempts.length + 1}`, state: 'deploying', scope, ...(operation ? { operation } : {}) }
    metadata.state = 'deploying'
    metadata.current_attempt_id = attempt.id
    attempts.push(attempt)
    return attempt
  }
  async function finishAttempt() {
    metadata.state = 'succeeded'
    attempts.at(-1)!.state = 'succeeded'
    await page.reload()
    await expect(page.getByTestId('detail-state')).toHaveText('succeeded')
  }
  await page.route(/\/v1\/(?:proxmox\/hosts|projects\/|deployments(?:[/?]|$))/, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    expect(request.headers().authorization).toBe('Bearer route-fixture-token')
    if (method !== 'GET') writes.push(`${method} ${path}`)
    if (path === '/v1/proxmox/hosts' && method === 'GET') return route.fulfill({ json: { items: [{ id: 'pve-happy', name: 'Happy target', node_name: 'pve01' }], total: 1 } })
    if (path.endsWith('/reservations') && method === 'POST') {
      const body: ReservationInput = request.postDataJSON()
      owner = request.headers()['x-range42-reservation-token']
      expect(owner).toMatch(/^[a-f0-9]{64}$/)
      expect(body.project_key).toBe(localId)
      expect(body.vms).toHaveLength(3)
      lease = { reservation_id: 'happy-lease', project_key: localId, host_id: 'pve-happy', node_name: 'pve01', checked_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 600_000).toISOString(), limitations: [], assignments: body.vms.map(vm => ({ node_id: vm.node_id, vm_id: vm.vm_id,
          nics: vm.nics.map(nic => ({ ...nic, ...body.networks.find(network => network.network_id === nic.network_id), index: nic.index, prefix: 24 })) })) }
      return route.fulfill({ json: lease })
    }
    if (path.includes('/reservations/') && method === 'GET') return route.fulfill({ json: lease })
    if (path === `/v1/projects/${backendId}` && method === 'PUT') {
      expect(request.postDataJSON()).toEqual({ name: project.name, source_id: 'catalog', branch_strategy: 'dedicated_repo', repo_owner: 'fixture', repo_name: 'work', subdir: '' })
      return route.fulfill({ json: { id: backendId, ...request.postDataJSON() } })
    }
    if (path === '/v1/deployments' && method === 'GET') return route.fulfill({ json: { items: [], total: 0 } })
    if (path === '/v1/deployments' && method === 'POST') {
      const body = request.postDataJSON()
      expect(body).toMatchObject({ project_id: backendId, allocation_reservation_id: 'happy-lease', project_sha: head, scenario_label: 'replicated', target_host_id: 'pve-happy' })
      expect(body).not.toHaveProperty('secrets')
      expect(request.headers()['x-range42-reservation-token']).toBe(owner)
      metadata = { ...metadata, project_sha: head }
      return route.fulfill({ status: 201, json: metadata })
    }
    if (path === `/v1/deployments/${deploymentId}` && method === 'GET') return route.fulfill({ json: metadata })
    if (path.endsWith('/allocations') && method === 'GET') {
      if (allocationsReleased) return route.fulfill({ status: 404, json: { code: 'ALLOCATION_NOT_FOUND' } })
      const manifest = JSON.parse(files['scenarios/replicated/manifest/scenario_vms.json'])
      return route.fulfill({ json: { deployment_id: deploymentId, project_sha: metadata.project_sha, host_id: 'pve-happy', node_name: 'pve01', created_at: new Date().toISOString(), assignments: manifest.vms } })
    }
    if (path.endsWith('/allocations') && method === 'DELETE') {
      expect(guestsExist).toBe(false)
      expect(createdNetworks.size).toBe(0)
      allocationsReleased = true
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/runtime') && method === 'GET') return route.fulfill({ json: {
      deployment_id: deploymentId, target_host_id: 'pve-happy', node_name: 'pve01', project_sha: metadata.project_sha,
      firewall: { datacenter_enabled: true, node_enabled: true, errors: [] }, sdn: { pending_changes: false, errors: [] },
      permissions: { admin: true, operate: true }, runtime: { available: true, contract: 'native-sdn-20260921', operations: ['sdn_network', 'sdn_snat'] },
      vms: vmManifest().vms.map((vm: { vm_id: number; vm_name: string }) => ({ vm_id: vm.vm_id, name: vm.vm_name, status: guestsExist ? 'owned' : 'missing', nics: [], firewall_enabled: false })),
      networks: networkManifest().vnets.map((network: { vnet: string; snat: boolean }) => ({ ...network, zone: networkManifest().zone,
        manifest_snat: network.snat, configured_snat: createdNetworks.has(network.vnet) ? nat.get(network.vnet) : null,
        identity_matches: createdNetworks.has(network.vnet), active: createdNetworks.has(network.vnet), live_forwarding_verified: false })),
    } })
    if (path.endsWith('/operations/plan') && method === 'POST') {
      const body = request.postDataJSON()
      expect(body).toMatchObject({ kind: 'sdn_network', acknowledge_shared_scope: true })
      const network = networkManifest().vnets.find((value: { vnet: string }) => value.vnet === body.vnet)
      expect(network).toBeDefined()
      if (body.action === 'delete' && guestsExist) return route.fulfill({ status: 409, json: { code: 'SDN_NETWORK_ATTACHED', message: 'This VNet still has attached guests or templates.' } })
      return route.fulfill({ json: { review_fingerprint: 'e'.repeat(64), target_host_id: 'pve-happy', target_identity: { node_name: 'pve01' },
        project_sha: metadata.project_sha, plan: { network: { ...network, zone: networkManifest().zone }, preserve_zone: true } } })
    }
    if (path.endsWith('/operations') && method === 'POST') {
      const body = request.postDataJSON()
      expect(body.acknowledge_shared_scope).toBe(true)
      expect(['blue1', 'red1']).toContain(body.vnet)
      if (body.kind === 'sdn_network') {
        expect(body.review_fingerprint).toBe('e'.repeat(64))
        expect(guestsExist).toBe(false)
        if (body.action === 'create') {
          expect(createdNetworks.has(body.vnet)).toBe(false)
          createdNetworks.add(body.vnet)
          nat.set(body.vnet, networkManifest().vnets.find((value: { vnet: string }) => value.vnet === body.vnet).snat)
        } else {
          expect(body.action).toBe('delete')
          expect(createdNetworks.has(body.vnet)).toBe(true)
          createdNetworks.delete(body.vnet)
          nat.delete(body.vnet)
        }
      } else {
        expect(body).toEqual({ kind: 'sdn_snat', vnet: 'red1', enabled: false, acknowledge_shared_scope: true })
        expect(guestsExist).toBe(true)
        nat.set(body.vnet, body.enabled)
      }
      return route.fulfill({ status: 201, json: startAttempt('runtime', { request: body }) })
    }
    if (path.endsWith('/preflight') && method === 'POST') return route.fulfill({ json: { result: 'pass', blocking: false, checks: [{ check: 'saved_manifest', result: 'pass' }] } })
    if (path.endsWith('/attempts') && method === 'GET') return route.fulfill({ json: { items: attempts, total: attempts.length } })
    if (path.endsWith('/attempts') && method === 'POST') {
      const body = request.postDataJSON()
      if (body.scope === 'full') {
        expect(body).toEqual({ scope: 'full' })
        expect([...createdNetworks].sort()).toEqual(['blue1', 'red1'])
        guestsExist = true
      } else {
        expect(body).toEqual({ scope: 'teardown', confirm_codename: 'HAPPY' })
        guestsExist = false
      }
      return route.fulfill({ status: 201, json: startAttempt(body.scope) })
    }
    return route.fallback()
  })

  await page.goto(`/project/${localId}`)
  await page.getByTestId('project-scenario').click()
  await page.getByTestId('allocation-reserve').click()
  await page.getByTestId('allocation-apply').click()
  await page.getByTestId('scenario-review').click()
  await page.getByTestId('scenario-apply').click()
  await expect(page.getByTestId('project-git-status')).toContainText(branch)
  await page.getByRole('complementary').getByRole('button', { name: 'Deploy', exact: true }).click()
  await expect(page.getByTestId('deploy-form')).toBeVisible()
  await page.getByTestId('deploy-field-codename').getByRole('textbox').fill('HAPPY')
  await page.getByTestId('deploy-sha-ack').getByRole('checkbox').check()
  await page.getByTestId('deploy-submit').click()
  await expect(page).toHaveURL(`/deployments/${deploymentId}`)
  await expect.poll(() => lockReleased).toBe(true)
  await expect(page.getByTestId('deployment-allocations').locator('li')).toHaveCount(3)
  await expect(page.getByTestId('deployment-start')).toBeDisabled()
  for (const vnet of ['blue1', 'red1']) {
    await page.getByTestId(`runtime-network-create-${vnet}`).click()
    await page.getByTestId('runtime-shared-ack').check()
    await page.getByTestId('runtime-apply').click()
    await expect(page.getByTestId('detail-state')).toHaveText('deploying')
    await finishAttempt()
    await expect(page.getByTestId('deployment-start')).toBeDisabled()
  }
  await page.getByTestId('deployment-run-preflight').click()
  await expect(page.getByTestId('deployment-start')).toBeEnabled()
  await page.getByTestId('deployment-start').click()
  await expect(page.getByTestId('detail-state')).toHaveText('deploying')
  await finishAttempt()
  const savedNetworks = files['scenarios/replicated/manifest/scenario_networks.json']
  await page.getByTestId('runtime-nat-red1').click()
  await page.getByTestId('runtime-shared-ack').check()
  await page.getByTestId('runtime-apply').click()
  await expect(page.getByTestId('detail-state')).toHaveText('deploying')
  await finishAttempt()
  await expect(page.getByTestId('runtime-nat-red1')).toHaveText('Enable outbound NAT')
  expect(files['scenarios/replicated/manifest/scenario_networks.json']).toBe(savedNetworks)

  const operationsBeforeRefusal = writes.filter(value => value.endsWith('/operations')).length
  await page.getByTestId('runtime-network-delete-blue1').click()
  await expect(page.getByTestId('runtime-controls')).toContainText('still has attached guests')
  await expect(page.getByTestId('runtime-apply')).toHaveCount(0)
  expect(writes.filter(value => value.endsWith('/operations'))).toHaveLength(operationsBeforeRefusal)

  await page.getByTestId('maintenance-scope').selectOption('teardown')
  await page.getByTestId('maintenance-preflight').click()
  await expect(page.getByTestId('maintenance-start')).toBeDisabled()
  await page.getByTestId('maintenance-confirm').fill('HAPPY')
  await page.getByTestId('maintenance-start').click()
  await expect(page.getByTestId('detail-state')).toHaveText('deploying')
  await finishAttempt()
  for (const vnet of ['blue1', 'red1']) {
    await page.getByTestId(`runtime-network-delete-${vnet}`).click()
    await page.getByTestId('runtime-shared-ack').check()
    await page.getByTestId('runtime-apply').click()
    await expect(page.getByTestId('detail-state')).toHaveText('deploying')
    await finishAttempt()
    await expect(page.getByTestId(`runtime-network-delete-${vnet}`)).toBeDisabled()
  }
  await page.getByTestId('allocation-review-release').click()
  await page.getByTestId('allocation-confirm-release').click()
  await expect(page.getByTestId('allocation-absent')).toContainText('released')
  expect(allocationsReleased).toBe(true)
  const instances: { instances: Array<{ vm_id: number }> } = JSON.parse(files['scenarios/replicated/manifest/scenario_instances.json'])
  expect(instances.instances.map(vm => vm.vm_id)).toEqual([3101, 3102, 3103])
  expect(JSON.stringify(files)).not.toContain(owner)
  expect(JSON.stringify(files)).not.toContain('route-fixture-token')
  expect(JSON.stringify(files)).not.toContain('git-fixture-token')
  expect(writes.slice(0, 3)).toEqual(['POST /v1/proxmox/hosts/pve-happy/reservations', `PUT /v1/projects/${backendId}`, 'POST /v1/deployments'])
  expect(attempts.map(attempt => attempt.scope)).toEqual(['runtime', 'runtime', 'full', 'runtime', 'teardown', 'runtime', 'runtime'])
  expect(writes.at(-1)).toBe(`DELETE /v1/deployments/${deploymentId}/allocations`)
  expect(gitWrites.some(write => write.startsWith('PATCH'))).toBe(true)
  expect(unexpected).toEqual([])
  expect(api.state.writes).toEqual([])
  expect(api.state.unexpected).toEqual([])
})
