import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { backendRequest } from '@/services/backendApi'

enableAutoUnmount(afterEach)
vi.mock('@/services/backendApi', () => ({backendRequest: vi.fn(), getBackendScope: () => 'fixture'}))
const modules = import.meta.glob('../components/settings/OptionalIntegrationsPanel.vue', {eager: true})
const candidate = Object.values(modules)[0] as {default: object} | undefined
const status = (configuration_state = 'not_configured') => ({optional: true, configuration_state,
  required_for_environment_deployment: false, provider_access_verified: false})
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia()); vi.clearAllMocks()
  vi.mocked(backendRequest).mockImplementation(async path => path === '/v1/auth/me' ? {role: 'admin'} : status())
})
async function open() {
  expect(candidate, 'Missing optional installation integrations settings panel').toBeDefined()
  const view = mount(candidate!.default)
  expect(backendRequest).not.toHaveBeenCalled()
  await view.get('[data-testid="integration-refresh"]').trigger('click'); await flushPromises()
  return view
}
it('shows optional integration configuration without treating it as an environment prerequisite', async () => {
  const view = await open()
  expect(view.text()).toContain('Not configured')
  expect(view.text()).toContain('Environment deployment does not require managed onboarding')
  expect(backendRequest).toHaveBeenCalledWith('/v1/integrations/identity', expect.anything())
  expect(view.find('input').exists()).toBe(false)
})
it('does not claim provider or laptop readiness from a configured transport', async () => {
  vi.mocked(backendRequest).mockImplementation(async path => path === '/v1/auth/me' ? {role: 'admin'} : status('configured'))
  const view = await open()
  expect(view.text()).toContain('Configured')
  expect(view.text()).toContain('Account provisioning and laptop access have not been verified')
})
it('never contacts integration settings for a non-administrator', async () => {
  vi.mocked(backendRequest).mockResolvedValue({role: 'operator'})
  const view = await open()
  expect(view.text()).toContain('Administrator access is required')
  expect(backendRequest).toHaveBeenCalledTimes(1)
})
it('clears configuration observations when the active backend changes', async () => {
  const backend = useBackendApiStore()
  backend.addHost({url: 'https://one.test'})
  const view = await open()
  const other = backend.addHost({url: 'https://two.test'})
  backend.setActiveHost(other); await flushPromises()
  expect(view.find('[data-testid="integration-state"]').exists()).toBe(false)
})
it('rejects optimistic readiness fields rather than showing success', async () => {
  vi.mocked(backendRequest).mockImplementation(async path => path === '/v1/auth/me' ? {role: 'admin'} : {...status(), provider_access_verified: true})
  const view = await open()
  expect(view.find('[role="alert"]').exists()).toBe(true)
  expect(view.find('[data-testid="integration-state"]').exists()).toBe(false)
})
