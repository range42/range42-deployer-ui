import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import EnvironmentNetworkPreparation from '@/components/deployment/EnvironmentNetworkPreparation.vue'
import { backendRequest } from '@/services/backendApi'

enableAutoUnmount(afterEach)
vi.mock('@/services/backendApi', () => ({backendRequest: vi.fn(), getBackendScope: () => 'network-fixture'}))
const environmentId = 'env-'+'a'.repeat(24)
const waiting = {deployment_id: 'foundation', requested: true, environment_id: environmentId,
  request_recorded: false, preparation_available: false, plan: null, receipt: null,
  issue: 'Retain the original template preparation request first.', execution_ready: false}
const reviewed = {...waiting, request_recorded: true, preparation_available: true, issue: '',
  plan: {environment_id: environmentId, owner: 'range42-environment:'+environmentId,
    networks: [{bridge: 'vmbr600', subnet: '10.78.0.0/28', gateway: '10.78.0.1'}],
    management: {bridge: 'vmbr550', subnet: '10.78.255.0/29', host_address: '10.78.255.1/29'}}}

function mounted() {
  return mount(EnvironmentNetworkPreparation, {props: {deploymentId: 'foundation', environmentId}, global: {plugins: [createPinia()]}})
}

it('reviews bridge ownership then uses the existing full foundation action', async () => {
  vi.mocked(backendRequest).mockResolvedValue(waiting)
  const view = mounted()
  await view.get('[data-testid="environment-network-load"]').trigger('click'); await flushPromises()
  expect(view.emitted('changed')?.at(-1)).toEqual([false])
  vi.mocked(backendRequest).mockResolvedValue(reviewed)
  await view.get('[data-testid="environment-network-review"]').trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenLastCalledWith('/v1/deployments/foundation/foundation/networks/review', expect.objectContaining({method: 'POST', body: '{}'}))
  expect(view.emitted('changed')?.at(-1)).toEqual([true])
  expect(view.text()).toContain('full deployment action')
  expect(view.text()).toContain('vmbr600')
  expect(view.text()).toContain('vmbr550')
  expect(view.text()).toContain('Each run owns its gateway')
  await view.setProps({environmentId})
  expect(view.emitted('changed')?.at(-1)).toEqual([true])
})

it('shows independently reconciled network readiness without granting general execution', async () => {
  vi.mocked(backendRequest).mockResolvedValue({...reviewed, receipt: {status: 'ready', environment_id: environmentId,
    request_digest: 'a'.repeat(64), network_ready: true, execution_ready: false, proof: {request_digest: 'a'.repeat(64)}}})
  const view = mounted()
  await view.get('[data-testid="environment-network-load"]').trigger('click'); await flushPromises()
  expect(view.text()).toContain('Bridge preparation verified')
  expect(view.text()).toContain('Gateway and participant deployment still need their own checks')
  await view.get('[data-testid="environment-network-reconcile"]').trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenLastCalledWith('/v1/deployments/foundation/foundation/networks/reconcile', expect.objectContaining({method: 'POST'}))
})

it.each(['environment', 'execution', 'readiness', 'ownership'])('rejects a mismatched %s reply and keeps apply blocked', async damage => {
  const value = structuredClone(reviewed)
  if (damage === 'environment') value.environment_id = 'env-'+'b'.repeat(24)
  if (damage === 'execution') value.execution_ready = true
  if (damage === 'readiness') value.request_recorded = false
  if (damage === 'ownership') value.plan.owner = 'somebody-else'
  vi.mocked(backendRequest).mockResolvedValue(value)
  const view = mounted()
  await view.get('[data-testid="environment-network-load"]').trigger('click'); await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('could not be verified')
  expect(view.emitted('changed')?.at(-1)).toEqual([false])
})

it('prevents requests while the original native attempt is active', async () => {
  const view = mounted()
  await view.setProps({disabled: true})
  expect((view.get('[data-testid="environment-network-load"]').element as HTMLButtonElement).disabled).toBe(true)
})
