import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Workshop from '@/components/deployment/DeploymentParticipants.vue'
import { backendRequest } from '@/services/backendApi'
import { reactive } from 'vue'
const connection = reactive({ url: 'http://test', token: 'alpha' })
vi.mock('@/stores/backendApiStore', () => ({useBackendApiStore: () => connection}))
vi.mock('@/services/backendApi', () => ({ backendRequest: vi.fn(), backendBlob: vi.fn(), getBackendScope: () => 'test' }))
const roster = { cohort_deployment_id: 'cohort-one', id: 'native-friday', expires_at: '2026-10-23T18:00:00Z', operations: [], seats: [
  { username: 'user01', account_ready: true, key_ready: true, handout_ready: true,
    proxmox_address: '10.77.32.2', deployer_address: '10.77.32.3', deployment_id: 'seat-one',
    deployment_state: 'succeeded', devices: [{ id: 5, address: '100.80.0.5', online: true, name: 'laptop' }] },
] }
beforeEach(() => { vi.clearAllMocks(); connection.url = 'http://test'; connection.token = 'alpha'; backendRequest.mockResolvedValue(roster) })
describe('workshop administration', () => {
  it('focuses participant confirmation after the modal becomes focusable on the next frame', async () => {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let visible = false
    const originalFocus = HTMLElement.prototype.focus
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (...args) {
      if (this.closest('[role="dialog"]') && !visible) return
      originalFocus.apply(this, args)
    })
    const view = mount(Workshop, {attachTo: document.body, props: {deploymentId: 'cohort-one'}, global: {stubs: ['RouterLink']}})
    try {
      await flushPromises()
      await view.get('[data-testid="reset-user01"]').trigger('click')
      visible = true
      frames.splice(0).forEach(callback => callback())
      await flushPromises()
      expect(document.activeElement).toBe(view.get('[data-testid="seat-confirmation"]').element)
    } finally { view.unmount(); focus.mockRestore(); vi.unstubAllGlobals() }
  })
  it('shows per-seat readiness, instance links and verified devices without exposing credentials', async () => {
    const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(view.text()).toContain('user01')
    expect(view.text()).toContain('100.80.0.5')
    expect(view.find('a[href="https://10.77.32.2:8006"]').exists()).toBe(true)
    expect(view.text()).toContain('Download credentials')
    view.unmount()
  })
  it('enables only the observed online participant device and refreshes the operation status', async () => {
    const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } }); await flushPromises()
    backendRequest.mockResolvedValueOnce({ operation_id: 'bind-1', state: 'queued' }).mockResolvedValue(roster)
    await view.get('[data-testid="bind-user01-5"]').trigger('click'); await flushPromises()
    expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'bind', username: 'user01', node_id: 5 }),
    }))
    view.unmount()
  })
  it('requires the selected seat name before dispatching a destructive reset', async () => {
    const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } }); await flushPromises()
    await view.get('[data-testid="reset-user01"]').trigger('click')
    const submit = view.get('[data-testid="confirm-destructive"]')
    expect(submit.attributes('disabled')).toBeDefined()
    await view.get('[data-testid="seat-confirmation"]').setValue('user02')
    expect(submit.attributes('disabled')).toBeDefined()
    await view.get('[data-testid="seat-confirmation"]').setValue('user01')
    backendRequest.mockResolvedValueOnce({ operation_id: 'reset-1', state: 'queued' }).mockResolvedValue(roster)
    await view.get('form').trigger('submit'); await flushPromises()
    expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({
      body: JSON.stringify({ action: 'reset', username: 'user01', confirmation: 'user01' }),
    }))
    view.unmount()
  })
})

it('lets the facilitator replace an unbound lost VPN key after confirming the participant', async () => {
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } }); await flushPromises()
  await view.get('[data-testid="replace-key-user01"]').trigger('click')
  await view.get('[data-testid="seat-confirmation"]').setValue('user01')
  backendRequest.mockResolvedValueOnce({ operation_id: 'key-1', state: 'queued' }).mockResolvedValue(roster)
  await view.get('form').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({
    body: JSON.stringify({ action: 'replace_key', username: 'user01', confirmation: 'user01' }),
  }))
  view.unmount()
})

it('allows retrying a failed initial deployment from the workshop page', async () => {
  backendRequest.mockResolvedValue({ ...roster, seats: [{ ...roster.seats[0], deployment_state: 'failed' }] })
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } }); await flushPromises()
  const button = view.findAll('button').find(button => button.text() === 'Deploy instance')
  expect(button.attributes('disabled')).toBeUndefined()
  view.unmount()
})

it.each([
  [{ action: 'deploy', username: 'user02', state: 'running' }, true],
  [{ action: 'reset', username: 'user01', state: 'running' }, false],
  [{ action: 'replace_key', username: 'user01', state: 'running' }, false],
  [{ action: 'handouts', state: 'running' }, false],
])('keeps private PDFs available unless their details are changing: %j', async (operation, available) => {
  backendRequest.mockResolvedValue({ ...roster, operations: [operation] })
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } }); await flushPromises()
  const button = view.findAll('button').find(button => button.text() === 'Download credentials')
  expect(button.attributes('disabled') === undefined).toBe(available)
  view.unmount()
})

it('keeps a failed revocation retry available after the desired grant has already been removed', async () => {
  backendRequest.mockResolvedValue({ ...roster, operations: [{ action: 'revoke', username: 'user01', state: 'failed' }],
    seats: [{ ...roster.seats[0], device: null }] })
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } }); await flushPromises()
  const retry = view.findAll('button').find(button => button.text() === 'Revoke laptop access')
  expect(retry).toBeDefined()
  await retry.trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({
    body: JSON.stringify({ action: 'revoke', username: 'user01' }),
  }))
  view.unmount()
})

it('retries the same failed binding while keeping other devices disabled', async () => {
  const device = { id: 5, address: '100.80.0.5', online: true, name: 'laptop', bound: true }
  backendRequest.mockResolvedValue({ ...roster, operations: [{ action: 'bind', username: 'user01', state: 'failed' }],
    seats: [{ ...roster.seats[0], device, devices: [device, { id: 6, address: '100.80.0.6', online: true, name: 'other' }] }] })
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } }); await flushPromises()
  expect(view.get('[data-testid="bind-user01-5"]').attributes('disabled')).toBeUndefined()
  expect(view.get('[data-testid="bind-user01-6"]').attributes('disabled')).toBeDefined()
  view.unmount()
})

it('hides participant controls for unrelated deployments', async () => {
  const view = mount(Workshop, { props: { deploymentId: 'unrelated' }, global: { stubs: ['RouterLink'] } })
  await flushPromises()
  expect(view.text()).not.toContain('user01')
  expect(view.find('[data-testid="reset-user01"]').exists()).toBe(false)
  view.unmount()
})
it('shows only the associated participant when opened from a seat deployment', async () => {
  backendRequest.mockResolvedValue({ ...roster, seats: [...roster.seats, { ...roster.seats[0], username: 'user02', deployment_id: 'seat-two' }] })
  const view = mount(Workshop, { props: { deploymentId: 'seat-one' }, global: { stubs: ['RouterLink'] } })
  await flushPromises()
  expect(view.text()).toContain('user01')
  expect(view.text()).not.toContain('user02')
  expect(view.text()).not.toContain('Create accounts')
  view.unmount()
})

it('shows an actionable error when the first participant status request fails', async () => {
  backendRequest.mockRejectedValue(new Error('Participant service unavailable'))
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } })
  await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('Participant service unavailable')
  expect(view.findAll('button').some(b => b.text() === 'Refresh status')).toBe(true)
  view.unmount()
})
it('can connect a qualified new cohort to participant management through the UI', async () => {
  const view = mount(Workshop, { props: { deploymentId: 'new-cohort', eligibleCohort: true }, global: { stubs: ['RouterLink'] } })
  await flushPromises()
  await view.get('[data-testid="workshop-link-deployment"]').trigger('click')
  await view.get('form').trigger('submit'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({ body: JSON.stringify({action:'link',deployment_id:'new-cohort'}) }))
  view.unmount()
})
it('disables participant changes while the parent deployment is running', async () => {
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one', disabled: true }, global: { stubs: ['RouterLink'] } })
  await flushPromises()
  expect(view.get('[data-testid="reset-user01"]').attributes('disabled')).toBeDefined()
  view.unmount()
})

it('blocks paused management changes while allowing emergency revocation and private handouts', async () => {
  backendRequest.mockResolvedValue({ ...roster, admission: { scope: 'legacy_controller_queue', state: 'paused', revision: 1,
    pause_id: 'a'.repeat(32), queued_count: 0, running_count: 0 }, seats: [{ ...roster.seats[0],
    device: { id: 5, address: '100.80.0.5', online: true, name: 'laptop', bound: true } }] })
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } })
  await flushPromises()
  expect(view.get('[data-testid="reset-user01"]').attributes('disabled')).toBeDefined()
  const button = text => view.findAll('button').find(item => item.text() === text)
  expect(button('Revoke laptop access').attributes('disabled')).toBeUndefined()
  expect(button('Download credentials').attributes('disabled')).toBeUndefined()
  expect(view.find('[data-testid="workshop-resume"]').exists()).toBe(true)
  await button('Revoke laptop access').trigger('click'); await flushPromises()
  expect(backendRequest).toHaveBeenCalledWith('/v1/admin/workshop/actions', expect.objectContaining({ body: JSON.stringify({action: 'revoke', username: 'user01'}) }))
  view.unmount()
})

it('clears a reviewed pause and ignores an earlier status reply when backend credentials change', async () => {
  let resolveEarlier
  backendRequest.mockImplementationOnce(() => new Promise(resolve => { resolveEarlier = resolve }))
  const view = mount(Workshop, { props: { deploymentId: 'cohort-one' }, global: { stubs: ['RouterLink'] } })
  await flushPromises()
  backendRequest.mockResolvedValue({ ...roster, seats: [{ ...roster.seats[0], username: 'user02' }] })
  connection.token = 'bravo'; await flushPromises()
  expect(view.text()).toContain('user02')
  resolveEarlier(roster); await flushPromises()
  expect(view.text()).not.toContain('user01')
  view.unmount()
})

it('blocks VM lifecycle controls until ownership is acknowledged and keeps account controls available', async () => {
  const view = mount(Workshop, {props:{deploymentId:'cohort-one',vmOperationsDisabled:true},global:{stubs:['RouterLink']}})
  await flushPromises()
  for (const label of ['Deploy instance','Check / configure','Reset instance','Delete instance']) {
    const button=view.findAll('button').find(button=>button.text()===label)
    expect(button.attributes('disabled')).toBeDefined()
  }
  expect(view.get('[data-testid="bind-user01-5"]').attributes('disabled')).toBeUndefined()
  expect(view.text()).toContain('Review existing ownership')
  view.unmount()
})
