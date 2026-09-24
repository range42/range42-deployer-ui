import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { routeApi } from './fixtures/routeApi'
import { customSimulation, pictureBytes } from '../src/__tests__/fixtures/customSimulation'
import { replicatedScenario } from '../src/__tests__/fixtures/replicatedScenario'

interface ReservationInput {
  project_key: string
  vms: Array<{ node_id: string; vm_id: number; nics: Array<{ index: number; nic_key: string; network_id: string; ip: string }> }>
  networks: Array<{ network_id: string; bridge: string; subnet: string; gateway?: string }>
}

for (const custom of [false, true]) test(custom ? 'custom simulation saves pictures, deploys two networks, updates its application and deletes its resources' : 'saved SDN replicas prepare networks, deploy, change NAT, teardown and release their allocations', async ({ page }) => {
  const localId = 'local-happy', backendId = 'backend-happy', deploymentId = 'happy-deployment'
  const branch = 'range42-ui/happy', base = 'b'.repeat(40)
  test.setTimeout(120_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const input = custom ? (await customSimulation(localId)).project : replicatedScenario()
  const label = input.scenario.label
  const vnets = custom ? input.scenario.networks.map(network => network.vnet) : ['blue1', 'red1']
  const natVnet = vnets[1], updatedNat = custom ? !input.scenario.networks[1].snat : false
  const expectedVmids = custom ? [3101] : [3101, 3102, 3103]
  const project = { ...input, id: localId, name: custom ? 'Custom application simulation' : 'Happy replicas',
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
  let files: Record<string, Buffer> = {}, pending: Record<string, Buffer> = {}
  const blobs = new Map<string, Buffer>()
  const textFile = (path: string) => files[path].toString('utf8')
  const blob = (content: Buffer) => createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
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
      files['.lock'] = Buffer.from(content)
      head = (++revision).toString(16).padStart(40, '0')
      lockReleased = JSON.parse(content).released === true
      return route.fulfill({ json: { content: { sha: blob(Buffer.from(content)) }, commit: { sha: head } } })
    }
    if (path.endsWith('/git/refs') && method === 'POST') {
      expect(body.ref).toBe(`refs/heads/${branch}`)
      expect([base, head]).toContain(body.sha)
      return route.fulfill({ status: 422, json: { message: 'Reference already exists' } })
    }
    if (path.includes('/git/commits/') && method === 'GET') return route.fulfill({ json: { tree: { sha: 'c'.repeat(40) } } })
    if (path.includes('/git/trees/') && method === 'GET') return route.fulfill({ json: {
      tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', sha: blob(Buffer.from(content)) })), truncated: false,
    } })
    if (path.endsWith('/git/blobs') && method === 'POST') {
      expect(body.encoding).toBe('base64')
      const content = Buffer.from(body.content, 'base64'), sha = blob(content)
      blobs.set(sha, content)
      return route.fulfill({ json: { sha } })
    }
    if (path.endsWith('/git/trees') && method === 'POST') {
      pending = { ...files }
      for (const entry of body.tree) {
        if (entry.sha === null) delete pending[entry.path]
        else if (entry.sha) { expect(blobs.has(entry.sha)).toBe(true); pending[entry.path] = blobs.get(entry.sha)! }
        else { expect(typeof entry.content).toBe('string'); pending[entry.path] = Buffer.from(entry.content) }
      }
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
  let metadata = { id: deploymentId, project_id: backendId, project_sha: '', applied_config_sha: '', target_host_id: 'pve-happy', codename: 'HAPPY', scenario_label: label, state: 'pending', team_count: 1, current_attempt_id: '' }
  const attempts: Array<{ id: string; state: string; scope: string; operation?: unknown }> = []
  const createdNetworks = new Set<string>(), nat = new Map<string, boolean>()
  let guestsExist = false, allocationsReleased = false
  const networkManifest = () => JSON.parse(textFile(`scenarios/${label}/manifest/scenario_networks.json`))
  const vmManifest = () => JSON.parse(textFile(`scenarios/${label}/manifest/scenario_vms.json`))
  function startAttempt(scope: string, operation?: unknown) {
    const attempt = { id: `happy-attempt-${attempts.length + 1}`, state: 'deploying', scope, project_sha: scope === 'configure' ? head : metadata.project_sha, ...(operation ? { operation } : {}) }
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
  await page.route(/\/v1\/(?:proxmox\/(?:hosts|runtime-capabilities)|projects\/|deployments(?:[/?]|$))/, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    expect(request.headers().authorization).toBe('Bearer route-fixture-token')
    if (method !== 'GET') writes.push(`${method} ${path}`)
    if (path === '/v1/proxmox/runtime-capabilities' && method === 'GET') return route.fulfill({ json: { version: 1, available: true, bootstrap_features: ['extra_nics', 'resources'], operations: ['sdn_network', 'sdn_snat'], management_access_available: true } })
    if (path === '/v1/proxmox/hosts' && method === 'GET') return route.fulfill({ json: { items: [{ id: 'pve-happy', name: 'Happy target', node_name: 'pve01' }], total: 1 } })
    if (path.endsWith('/reservations') && method === 'POST') {
      const body: ReservationInput = request.postDataJSON()
      owner = request.headers()['x-range42-reservation-token']
      expect(owner).toMatch(/^[a-f0-9]{64}$/)
      expect(body.project_key).toBe(localId)
      expect(body.vms).toHaveLength(expectedVmids.length)
      if (custom) expect(body.vms[0].nics).toHaveLength(2)
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
      expect(body).toMatchObject({ project_id: backendId, allocation_reservation_id: 'happy-lease', project_sha: head, scenario_label: label, target_host_id: 'pve-happy' })
      expect(body).not.toHaveProperty('secrets')
      expect(request.headers()['x-range42-reservation-token']).toBe(owner)
      metadata = { ...metadata, project_sha: head }
      return route.fulfill({ status: 201, json: metadata })
    }
    if (path === `/v1/deployments/${deploymentId}` && method === 'GET') return route.fulfill({ json: metadata })
    if (path.endsWith('/allocations') && method === 'GET') {
      if (allocationsReleased) return route.fulfill({ status: 404, json: { code: 'ALLOCATION_NOT_FOUND' } })
      const manifest = JSON.parse(textFile(`scenarios/${label}/manifest/scenario_vms.json`))
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
      expect(vnets).toContain(body.vnet)
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
        expect(body).toEqual({ kind: 'sdn_snat', vnet: natVnet, enabled: updatedNat, acknowledge_shared_scope: true })
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
        expect([...createdNetworks].sort()).toEqual([...vnets].sort())
        guestsExist = true
      } else if (body.scope === 'configure') {
        expect(custom).toBe(true)
        expect(body).toEqual({ scope: 'configure', project_sha: head })
        expect(body.project_sha).not.toBe(metadata.project_sha)
        expect(guestsExist).toBe(true)
        metadata.applied_config_sha = body.project_sha
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
  await expect(page.getByTestId('scenario-apply')).toBeVisible()
  await page.getByTestId('scenario-apply').click()
  await expect(page.getByTestId('project-git-status')).toContainText(branch)
  await page.getByRole('complementary').getByRole('button', { name: 'Deploy', exact: true }).click()
  await expect(page.getByTestId('deploy-form')).toBeVisible()
  await page.getByTestId('deploy-field-codename').getByRole('textbox').fill('HAPPY')
  await page.getByTestId('deploy-sha-ack').getByRole('checkbox').check()
  await page.getByTestId('deploy-submit').click()
  await expect(page).toHaveURL(`/deployments/${deploymentId}`)
  await expect.poll(() => lockReleased).toBe(true)
  await expect(page.getByTestId('deployment-allocations').locator('li')).toHaveCount(expectedVmids.length)
  await expect(page.getByTestId('deployment-start')).toBeDisabled()
  for (const vnet of vnets) {
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
  if (custom) {
    const assetPath = `scenarios/${label}/content/workloads/web/payload/site/logo.png`
    expect(files[assetPath]).toEqual(Buffer.from(pictureBytes))
    expect(gitWrites.some(write => write.endsWith('/git/blobs'))).toBe(true)
    const previousSha = metadata.project_sha
    await page.goto(`/project/${localId}`)
    await page.getByRole('tab', { name: 'Config', exact: true }).click()
    await page.locator(`[data-path="${assetPath}"]`).click()
    await expect(page.getByTestId('asset-metadata')).toContainText('image/png')
    const replacement = Buffer.from(pictureBytes); replacement[replacement.length - 1] ^= 1
    await page.getByTestId('file-asset-field').locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: replacement })
    await expect(page.getByTestId('asset-download')).toHaveAttribute('href', `data:application/octet-stream;base64,${replacement.toString('base64')}`)
    await page.getByTestId('workload-review').click()
    await expect(page.getByTestId('workload-review-summary')).toContainText('site/logo.png')
    await page.getByTestId('workload-review-apply').click()
    await page.getByRole('button', { name: 'Save project', exact: true }).click()
    await expect.poll(() => files[assetPath]?.equals(replacement)).toBe(true)
    await expect.poll(() => head).not.toBe(previousSha)
    await expect(page.getByRole('button', { name: 'Save project', exact: true })).toBeEnabled()
    await page.goto(`/deployments/${deploymentId}`)
    await page.getByTestId('maintenance-scope').selectOption('configure')
    await page.getByTestId('configure-project-sha').fill(head)
    await page.getByTestId('maintenance-preflight').click()
    await page.getByTestId('maintenance-start').click()
    await expect(page.getByTestId('detail-state')).toHaveText('deploying')
    await finishAttempt()
    expect(metadata.applied_config_sha).toBe(head)
    expect(metadata.project_sha).toBe(previousSha)
  }
  const savedNetworks = textFile(`scenarios/${label}/manifest/scenario_networks.json`)
  await page.getByTestId(`runtime-nat-${natVnet}`).click()
  await page.getByTestId('runtime-shared-ack').check()
  await page.getByTestId('runtime-apply').click()
  await expect(page.getByTestId('detail-state')).toHaveText('deploying')
  await finishAttempt()
  await expect(page.getByTestId(`runtime-nat-${natVnet}`)).toHaveText(updatedNat ? 'Disable outbound NAT' : 'Enable outbound NAT')
  expect(textFile(`scenarios/${label}/manifest/scenario_networks.json`)).toBe(savedNetworks)

  const operationsBeforeRefusal = writes.filter(value => value.endsWith('/operations')).length
  await page.getByTestId(`runtime-network-delete-${vnets[0]}`).click()
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
  for (const vnet of vnets) {
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
  const instances: { instances: Array<{ vm_id: number }> } = custom ? { instances: vmManifest().vms } : JSON.parse(textFile(`scenarios/${label}/manifest/scenario_instances.json`))
  expect(instances.instances.map(vm => vm.vm_id)).toEqual(expectedVmids)
  expect(JSON.stringify(files)).not.toContain(owner)
  expect(JSON.stringify(files)).not.toContain('route-fixture-token')
  expect(JSON.stringify(files)).not.toContain('git-fixture-token')
  expect(writes.slice(0, 3)).toEqual(['POST /v1/proxmox/hosts/pve-happy/reservations', `PUT /v1/projects/${backendId}`, 'POST /v1/deployments'])
  expect(attempts.map(attempt => attempt.scope)).toEqual(['runtime', 'runtime', 'full', ...(custom ? ['configure'] : []), 'runtime', 'teardown', 'runtime', 'runtime'])
  expect(writes.at(-1)).toBe(`DELETE /v1/deployments/${deploymentId}/allocations`)
  expect(gitWrites.some(write => write.startsWith('PATCH'))).toBe(true)
  expect(pageErrors).toEqual([])
  expect(unexpected).toEqual([])
  expect(api.state.writes).toEqual([])
  expect(api.state.unexpected).toEqual([])
})
