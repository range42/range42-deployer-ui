import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import FoundationExecution from '@/components/deployment/FoundationExecution.vue'
import { backendRequest } from '@/services/backendApi'

enableAutoUnmount(afterEach)
vi.mock('@/services/backendApi', () => ({backendRequest: vi.fn(), getBackendScope: () => 'foundation-fixture'}))
const waiting = {deployment_id: 'run', request_recorded: false, preparation_available: false, receipt: null,
  issue: 'Review and retain the original request.', execution_ready: false, infrastructure_qualified: false}

it('retains the reviewed request and opens only the foundation action', async () => {
  vi.mocked(backendRequest).mockResolvedValue(waiting)
  const view = mount(FoundationExecution, {props: {deploymentId: 'run', templateIds: [9240, 9241]}, global: {plugins: [createPinia()]}})
  await view.get('[data-testid="foundation-status-refresh"]').trigger('click'); await flushPromises()
  expect(view.emitted('changed')?.at(-1)).toEqual([false])
  vi.mocked(backendRequest).mockResolvedValue({...waiting, request_recorded: true, preparation_available: true, issue: ''})
  await view.get('[data-testid="foundation-request-review"]').trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenLastCalledWith('/v1/deployments/run/foundation/review', expect.objectContaining({method: 'POST', body: '{}'}))
  expect(view.emitted('changed')?.at(-1)).toEqual([true])
  expect(view.text()).toContain('Apply or resume')
  expect(view.text()).toContain('Bridges and run gateways')
})

it('shows an uncertain clone and preserves its ownership for explicit reconciliation', async () => {
  vi.mocked(backendRequest).mockResolvedValue({...waiting, request_recorded: true, preparation_available: true, receipt: {
    status: 'uncertain', foundation_ready: false, templates: [{vm_id: 9240, phase: 'clone_intent'}, {vm_id: 9241, phase: 'pending'}]}})
  const view = mount(FoundationExecution, {props: {deploymentId: 'run', templateIds: [9240, 9241]}, global: {plugins: [createPinia()]}})
  await view.get('[data-testid="foundation-status-refresh"]').trigger('click'); await flushPromises()
  expect(view.emitted('changed')?.at(-1)).toEqual([false])
  expect(view.text()).toContain('Clone outcome is uncertain')
  expect(view.find('[data-testid="foundation-node-refresh"]').exists()).toBe(true)
})

it('rejects replies for foreign template copies without enabling deployment', async () => {
  vi.mocked(backendRequest).mockResolvedValue({...waiting, request_recorded: true, preparation_available: true, receipt: {
    status: 'complete', foundation_ready: true, templates: [{vm_id: 9230, phase: 'complete'}, {vm_id: 9222, phase: 'complete'}]}})
  const view = mount(FoundationExecution, {props: {deploymentId: 'run', templateIds: [9240, 9241]}, global: {plugins: [createPinia()]}})
  await view.get('[data-testid="foundation-status-refresh"]').trigger('click'); await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('could not be verified')
  expect(view.emitted('changed')?.at(-1)).toEqual([false])
})

it('keeps the reviewed request when its parent rerenders the same template identities', async () => {
  vi.mocked(backendRequest).mockResolvedValue({...waiting, request_recorded: true, preparation_available: true, issue: ''})
  const view = mount(FoundationExecution, {props: {deploymentId: 'run', templateIds: [9240, 9241]}, global: {plugins: [createPinia()]}})
  await view.get('[data-testid="foundation-status-refresh"]').trigger('click'); await flushPromises()
  expect(view.emitted('changed')?.at(-1)).toEqual([true])
  await view.setProps({templateIds: [9240, 9241]})
  expect(view.text()).toContain('Apply or resume')
  expect(view.emitted('changed')?.at(-1)).toEqual([true])
})
