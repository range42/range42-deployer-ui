import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import People from '@/components/deployment/RunPeople.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { backendRequest } from '@/services/backendApi'

enableAutoUnmount(afterEach)
vi.mock('@/services/backendApi', () => ({ backendRequest: vi.fn(), getBackendScope: () => 'fixture' }))
const person = 'person-' + '1'.repeat(32)
const initial = () => ({deployment_id: 'run-a', expires_at: '2030-01-02T00:00:00Z', teams: ['user01'], run_revision: 'b'.repeat(64),
  participants_per_environment: 1,
  state: {registry_id: 'a'.repeat(32), revision: 7,
    scopes: [{ref: 'run-a', expires_at: '2030-01-02T00:00:00Z', participant_limit_per_team: 1}],
    people: [{id: person, kind: 'temporary', enabled: true, generation: 1, reconcile_state: 'unconfigured'}],
    source_references: [{scope_ref: 'run-a', record_ref: 'user01', person_id: person}],
    memberships: [] as {person_id: string; scope_ref: string; role: string; team_ref: string; active: boolean; effective: boolean}[],
    providers: [], bindings: [], jobs: []}})
let review: ReturnType<typeof initial>
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia()); review = initial(); vi.clearAllMocks()
  vi.mocked(backendRequest).mockImplementation(async path => path === '/v1/auth/me' ? {role: 'admin'} : path.endsWith('/identities/capabilities') ? {
    deployment_id: 'run-a', optional: true, configuration_state: 'configured', provider_access_verified: false,
    required_for_environment_deployment: false,
  } : structuredClone(review))
})
async function open() {
  const view = mount(People, {props: {deploymentId: 'run-a'}})
  expect(backendRequest).not.toHaveBeenCalled()
  await view.get('[data-testid="people-refresh"]').trigger('click'); await flushPromises()
  return view
}
it('opens a run roster in Overview and explains unconfigured provider access', async () => {
  const view = await open()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/run-a/identities', expect.anything())
  expect(view.text()).toContain('user01')
  expect(view.text()).toContain('Unconfigured')
  expect(view.text()).toContain('Login and laptop access require verified integrations')
})
it('registers a scoped alias using the reviewed registry and run revisions', async () => {
  const view = await open()
  await view.get('[data-testid="person-alias"]').setValue('user02')
  await view.get('[data-testid="person-register-form"]').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/run-a/identities', expect.objectContaining({method: 'POST', body: JSON.stringify({
    registry_id: 'a'.repeat(32), expected_revision: 7, run_revision: 'b'.repeat(64),
    operation: {type: 'person.register', record_ref: 'user02', kind: 'temporary', person_id: null},
  })}))
})
it('selects only server-provided seats when assigning a person to the run', async () => {
  const view = await open()
  await view.get('[data-testid="membership-person"]').setValue(person)
  await view.get('[data-testid="membership-team"]').setValue('user01')
  await view.get('[data-testid="membership-form"]').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/run-a/identities', expect.objectContaining({method: 'POST', body: JSON.stringify({
    registry_id: 'a'.repeat(32), expected_revision: 7, run_revision: 'b'.repeat(64),
    operation: {type: 'membership.set', person_id: person, role: 'participant', team_ref: 'user01'},
  })}))
})
it('requires exact confirmation before removing only this run membership', async () => {
  review.state.memberships.push({person_id: person, scope_ref: 'run-a', role: 'participant', team_ref: 'user01', active: true, effective: true})
  const view = await open()
  await view.get('[data-testid="membership-remove"]').trigger('click')
  expect(view.get('[data-testid="membership-confirm-remove"]').attributes('disabled')).toBeDefined()
  await view.get('[data-testid="membership-confirm-alias"]').setValue('someone-else')
  expect(view.get('[data-testid="membership-confirm-remove"]').attributes('disabled')).toBeDefined()
  await view.get('[data-testid="membership-confirm-alias"]').setValue('user01')
  await view.get('[data-testid="membership-remove-form"]').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/run-a/identities', expect.objectContaining({method: 'POST', body: JSON.stringify({
    registry_id: 'a'.repeat(32), expected_revision: 7, run_revision: 'b'.repeat(64), operation: {type: 'membership.remove', person_id: person},
  })}))
})
it('clears the stale review after a failed submission and never replays it', async () => {
  const view = await open()
  vi.mocked(backendRequest).mockRejectedValueOnce(new Error('Identity state changed. Refresh before retrying.'))
  await view.get('[data-testid="person-alias"]').setValue('user02')
  await view.get('[data-testid="person-register-form"]').trigger('submit'); await flushPromises()
  expect(view.text()).toContain('Refresh before retrying')
  expect(view.find('[data-testid="person-register-form"]').exists()).toBe(false)
  expect(vi.mocked(backendRequest).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})
it('never reads the roster or offers changes to a non-administrator', async () => {
  vi.mocked(backendRequest).mockResolvedValue({role: 'operator'})
  const view = await open()
  expect(view.text()).toContain('Administrator access is required')
  expect(backendRequest).toHaveBeenCalledTimes(1)
  expect(view.find('[data-testid="person-register-form"]').exists()).toBe(false)
})
it('clears the review and draft when the backend changes', async () => {
  const backend = useBackendApiStore()
  backend.addHost({url: 'https://one.test'})
  const view = await open()
  await view.get('[data-testid="person-alias"]').setValue('old-backend-user')
  const other = backend.addHost({url: 'https://two.test'})
  backend.setActiveHost(other)
  await flushPromises()
  expect(view.find('[data-testid="person-register-form"]').exists()).toBe(false)
  expect(view.text()).not.toContain('user01')
})
it('explicitly reuses the selected returning person and preserves its permanent kind', async () => {
  review.state.people[0]!.kind = 'permanent'
  const view = await open()
  await view.get('[data-testid="person-alias"]').setValue('returning-user')
  const selectors = view.get('[data-testid="person-register-form"]').findAll('select')
  await selectors[0]!.setValue(person)
  await view.get('[data-testid="person-register-form"]').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/run-a/identities', expect.objectContaining({method: 'POST', body: JSON.stringify({
    registry_id: 'a'.repeat(32), expected_revision: 7, run_revision: 'b'.repeat(64),
    operation: {type: 'person.register', record_ref: 'returning-user', kind: 'permanent', person_id: person},
  })}))
})
it('blocks a participant seat already assigned to another person', async () => {
  const other = 'person-' + '2'.repeat(32)
  review.state.people.push({id: other, kind: 'temporary', enabled: true, generation: 1, reconcile_state: 'unconfigured'})
  review.state.source_references.push({scope_ref: 'run-a', record_ref: 'user02', person_id: other})
  review.state.memberships.push({person_id: person, scope_ref: 'run-a', role: 'participant', team_ref: 'user01', active: true, effective: true})
  const view = await open()
  await view.get('[data-testid="membership-person"]').setValue(person)
  await view.get('[data-testid="membership-team"]').setValue('user01')
  await view.get('[data-testid="membership-person"]').setValue(other)
  expect(view.get('[data-testid="membership-team"] option[value="user01"]').attributes('disabled')).toBeDefined()
  await view.get('[data-testid="membership-form"]').trigger('submit'); await flushPromises()
  expect(vi.mocked(backendRequest).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
})

it('keeps unconfigured optional onboarding separate from environment deployment', async () => {
  vi.mocked(backendRequest).mockImplementation(async path => path === '/v1/auth/me' ? {role: 'admin'} : {
    deployment_id: 'run-a', optional: true, configuration_state: 'not_configured', provider_access_verified: false,
    required_for_environment_deployment: false,
  })
  const view = await open()
  expect(view.text()).toContain('Managed onboarding is optional')
  expect(view.text()).toContain('Environment deployment does not require this integration')
  expect(view.find('[data-testid="person-register-form"]').exists()).toBe(false)
  expect(vi.mocked(backendRequest).mock.calls.some(([path]) => path.endsWith('/identities'))).toBe(false)
})

it('allows a second group member and refuses a third using the saved server limit', async () => {
  review.participants_per_environment = 2
  review.state.scopes[0]!.participant_limit_per_team = 2
  const second = 'person-' + '2'.repeat(32), third = 'person-' + '3'.repeat(32)
  for (const [index, id] of [second, third].entries()) {
    review.state.people.push({id, kind: 'temporary', enabled: true, generation: 1, reconcile_state: 'unconfigured'})
    review.state.source_references.push({scope_ref: 'run-a', record_ref: `user0${index + 2}`, person_id: id})
  }
  review.state.memberships.push({person_id: person, scope_ref: 'run-a', role: 'participant', team_ref: 'user01', active: true, effective: true})
  const view = await open()
  await view.get('[data-testid="membership-person"]').setValue(second)
  expect(view.get('[data-testid="membership-team"] option[value="user01"]').attributes('disabled')).toBeUndefined()
  await view.get('[data-testid="membership-team"]').setValue('user01')
  await view.get('[data-testid="membership-form"]').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/deployments/run-a/identities', expect.objectContaining({method: 'POST', body: expect.stringContaining(second)}))
  review.state.memberships.push({person_id: second, scope_ref: 'run-a', role: 'participant', team_ref: 'user01', active: true, effective: true})
  await view.get('[data-testid="people-refresh"]').trigger('click'); await flushPromises()
  await view.get('[data-testid="membership-person"]').setValue(third)
  expect(view.get('[data-testid="membership-team"] option[value="user01"]').attributes('disabled')).toBeDefined()
})
