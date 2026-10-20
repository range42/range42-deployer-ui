import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Participants from '@/components/deployment/WorkshopRunParticipants.vue'
import { backendRequest } from '@/services/backendApi'

enableAutoUnmount(afterEach)
vi.mock('@/services/backendApi', () => ({ backendRequest: vi.fn(), backendBlob: vi.fn(), getBackendScope: () => 'fixture' }))
const roster = {deployment_id: 'independent-a', namespace: 'training-a', phase: 'prepared', ready: false,
  expires_at: '2030-10-23T18:00:00Z', identity: {mode: 'instance-local'}, access: {state: 'not_configured'},
  permissions: {manage_instances: true, download_credentials: true},
  participants: [{username: 'user01', seat: 1, state: 'prepared', proxmox_address: '10.78.0.2', deployer_address: '10.78.0.3'}]}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(backendRequest).mockResolvedValue(roster) })

it('manages one owned run in deployment Overview without claiming unconfigured laptop access', async () => {
  const view = mount(Participants, {props: {deploymentId: 'independent-a'}, global: {plugins: [createPinia()]}})
  await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/independent-a/workshop')
  expect(view.text()).toContain('training-a')
  expect(view.text()).toContain('Laptop access is not configured')
  expect(view.get('a[href="https://10.78.0.2:8006"]').text()).toContain('10.78.0.2')
  await view.get('[data-testid="run-reset-user01"]').trigger('click')
  expect(view.get('[data-testid="run-confirm-action"]').attributes('disabled')).toBeDefined()
  await view.get('[data-testid="run-confirm-participant"]').setValue('user02')
  expect(view.get('[data-testid="run-confirm-action"]').attributes('disabled')).toBeDefined()
  await view.get('[data-testid="run-confirm-participant"]').setValue('user01')
  vi.mocked(backendRequest).mockResolvedValueOnce({id: 'attempt-a', state: 'pending'}).mockResolvedValue(roster)
  await view.get('form').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/independent-a/workshop/participants/user01/actions',
    expect.objectContaining({method: 'POST', body: JSON.stringify({action: 'reset', confirmation: 'user01'})}))
  expect(view.text()).toContain('attempt-a')
})

it('hides privileged handouts and prevents mutation for a read-only identity', async () => {
  vi.mocked(backendRequest).mockResolvedValue({...roster, permissions: {manage_instances: false, download_credentials: false}})
  const view = mount(Participants, {props: {deploymentId: 'independent-a'}, global: {plugins: [createPinia()]}})
  await flushPromises()
  expect(view.find('[data-testid="run-handout-user01"]').exists()).toBe(false)
  expect(view.get('[data-testid="run-reset-user01"]').attributes('disabled')).toBeDefined()
})

it('shows a failed reset in its confirmation dialog and permits a deliberate retry', async () => {
  const view = mount(Participants, {props: {deploymentId: 'independent-a'}, global: {plugins: [createPinia()]}})
  await flushPromises()
  await view.get('[data-testid="run-reset-user01"]').trigger('click')
  await view.get('[data-testid="run-confirm-participant"]').setValue('user01')
  vi.mocked(backendRequest).mockRejectedValueOnce(new Error('Resource is busy; retry after the active attempt ends.'))
  await view.get('form').trigger('submit'); await flushPromises()
  expect(view.get('[role="dialog"]').text()).toContain('Resource is busy')
  expect(view.get('[data-testid="run-confirm-action"]').attributes('disabled')).toBeUndefined()
  vi.mocked(backendRequest).mockResolvedValueOnce({id: 'retry-attempt', state: 'pending'}).mockResolvedValue(roster)
  await view.get('form').trigger('submit'); await flushPromises()
  expect(view.find('[role="dialog"]').exists()).toBe(false)
  expect(view.text()).toContain('retry-attempt')
})

it('explains shared environment ownership and group-wide reset without implying named onboarding', async () => {
  const view = mount(Participants, {props: {deploymentId: 'independent-a', participantsPerEnvironment: 2}, global: {plugins: [createPinia()]}})
  await flushPromises()
  expect(view.text()).toContain('Group environments')
  expect(view.text()).toContain('Up to 2 participants share each environment')
  await view.get('[data-testid="run-reset-user01"]').trigger('click')
  expect(view.get('[role="dialog"]').text()).toContain('This affects both members of this group')
  expect(view.get('[role="dialog"]').text()).toContain('Other group environments are retained')
  await view.get('button[type="button"]').trigger('click')
  expect(vi.mocked(backendRequest).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})
