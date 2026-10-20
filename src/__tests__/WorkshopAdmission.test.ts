import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopAdmission from '@/components/deployment/WorkshopAdmission.vue'
import { backendRequest } from '@/services/backendApi'
import { reactive } from 'vue'
const connection = reactive({ url: 'http://test', token: 'alpha' })
vi.mock('@/stores/backendApiStore', () => ({useBackendApiStore: () => connection}))

vi.mock('@/services/backendApi', () => ({ backendRequest: vi.fn(), getBackendScope: () => 'test' }))
const open = { scope: 'legacy_controller_queue' as const, state: 'open' as const, revision: 0, pause_id: null, queued_count: 0, running_count: 0 }
const paused = { ...open, state: 'paused' as const, revision: 1, pause_id: 'a'.repeat(32) }
beforeEach(() => { vi.clearAllMocks(); connection.token = 'alpha' })

describe('durable participant-management pause', () => {
  it('pauses admission while accepted jobs are still running', async () => {
    vi.mocked(backendRequest).mockResolvedValue({ ...paused, state: 'draining', running_count: 1 })
    const view = mount(WorkshopAdmission, { props: { admission: { ...open, running_count: 1 } } })
    await view.get('[data-testid="workshop-pause"]').trigger('click'); await flushPromises()
    const [path, options] = vi.mocked(backendRequest).mock.calls[0]!
    expect(path).toBe('/v1/admin/workshop/admission')
    expect(JSON.parse(options!.body as string)).toEqual({ action: 'pause', expected_revision: 0, request_id: expect.stringMatching(/^[a-f0-9]{32}$/) })
    expect(view.emitted('changed')).toHaveLength(1)
    view.unmount()
  })

  it('requires deliberate confirmation tied to this pause before resuming', async () => {
    vi.mocked(backendRequest).mockResolvedValue({ ...open, revision: 2 })
    const view = mount(WorkshopAdmission, { props: { admission: paused } })
    await view.get('[data-testid="workshop-resume"]').trigger('click'); await flushPromises()
    expect(view.get('[data-testid="workshop-resume-confirm"]').attributes('disabled')).toBeDefined()
    await view.get('input').setValue('resume')
    expect(view.get('[data-testid="workshop-resume-confirm"]').attributes('disabled')).toBeDefined()
    await view.get('input').setValue('RESUME')
    await view.get('form').trigger('submit'); await flushPromises()
    expect(JSON.parse(vi.mocked(backendRequest).mock.calls[0]![1]!.body as string)).toEqual({
      action: 'resume', expected_revision: 1, pause_id: 'a'.repeat(32), confirmation: 'RESUME', request_id: expect.stringMatching(/^[a-f0-9]{32}$/),
    })
    expect(view.find('[role="dialog"]').exists()).toBe(false)
    view.unmount()
  })

  it('never offers resume while draining or falsely calls queue quiescence safe VM capacity', async () => {
    const view = mount(WorkshopAdmission, { props: { admission: { ...paused, state: 'draining', queued_count: 1 } } })
    expect(view.text()).toContain('1 queued')
    expect(view.find('[data-testid="workshop-resume"]').exists()).toBe(false)
    expect(view.text()).toContain('VM power controls and deployment actions')
    view.unmount()
  })

  it('refreshes durable state after a lost response without replaying a change', async () => {
    vi.mocked(backendRequest).mockRejectedValue(new Error('Response lost'))
    const view = mount(WorkshopAdmission, { props: { admission: open } })
    await view.get('[data-testid="workshop-pause"]').trigger('click'); await flushPromises()
    expect(backendRequest).toHaveBeenCalledTimes(1)
    expect(view.get('[role="alert"]').text()).toContain('Response lost')
    expect(view.emitted('changed')).toHaveLength(1)
    view.unmount()
  })

  it('invalidates an open resume dialog when the pause generation changes', async () => {
    const view = mount(WorkshopAdmission, { props: { admission: paused } })
    await view.get('[data-testid="workshop-resume"]').trigger('click')
    await view.get('input').setValue('RESUME')
    await view.setProps({ admission: { ...paused, revision: 3, pause_id: 'b'.repeat(32) } })
    expect(view.find('[role="dialog"]').exists()).toBe(false)
    expect(backendRequest).not.toHaveBeenCalled()
    view.unmount()
  })

  it('shows missing capability without presenting an effective pause', () => {
    const view = mount(WorkshopAdmission, { props: { admission: null } })
    expect(view.text()).toContain('not installed')
    expect(view.find('[data-testid="workshop-pause"]').exists()).toBe(false)
    view.unmount()
  })

  it('clears resume confirmation when the backend principal changes', async () => {
    const view = mount(WorkshopAdmission, { props: { admission: paused } })
    await view.get('[data-testid="workshop-resume"]').trigger('click')
    await view.get('input').setValue('RESUME')
    connection.token = 'bravo'; await flushPromises()
    expect(view.find('[role="dialog"]').exists()).toBe(false)
    expect(backendRequest).not.toHaveBeenCalled()
    view.unmount()
  })
})
