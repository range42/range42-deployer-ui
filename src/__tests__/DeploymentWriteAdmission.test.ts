import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import Admission from '@/components/deployment/DeploymentWriteAdmission.vue'
import { backendRequest } from '@/services/backendApi'
const connection = reactive({url:'http://test', token:'alpha', activeHost:{id:'first'}})
vi.mock('@/stores/backendApiStore', () => ({useBackendApiStore: () => connection}))
vi.mock('@/services/backendApi', () => ({backendRequest:vi.fn(), getBackendScope:()=>connection.url}))
const open = {scope:'managed_deployment_writers', deployment_id:'run', available:true, state:'open', revision:0, pause_id:null,
  vm_ids:[45000,45001], active_attempts:0, held_workspace_locks:0, active_snapshot_operations:0, changed_by:null, changed_at:null,
  remote_quiescence_verified:false, capacity_borrowing_allowed:false}
const closed = {...open, state:'closed', revision:1, pause_id:'a'.repeat(32), changed_by:'director'}
beforeEach(() => {vi.resetAllMocks();connection.url='http://test';connection.token='alpha'})
async function loaded(state = open, role = 'admin') {
  vi.mocked(backendRequest).mockClear()
  vi.mocked(backendRequest).mockImplementation(async (path) => path === '/v1/auth/me' ? {role} : state)
  const view = mount(Admission, {props:{deploymentId:'run'}})
  expect(backendRequest).not.toHaveBeenCalled()
  await view.get('[data-testid="write-admission-refresh"]').trigger('click');await flushPromises()
  return view
}
describe('managed deployment write admission', () => {
  it('loads on request and pauses only the reviewed deployment without client VM IDs', async () => {
    const view = await loaded()
    expect(view.text()).toContain('45000')
    vi.mocked(backendRequest).mockResolvedValue(closed)
    await view.get('[data-testid="write-admission-pause"]').trigger('click');await flushPromises()
    const call = vi.mocked(backendRequest).mock.calls.find(([,init])=>init?.method==='POST')!
    expect(call[0]).toBe('/v1/deployments/run/write-admission')
    expect(JSON.parse(call[1]!.body as string)).toEqual({action:'pause', expected_revision:0, request_id:expect.stringMatching(/^[a-f0-9]{32}$/)})
    expect(view.emitted('changed')?.at(-1)).toEqual([true])
    expect(view.text()).toContain('Closed')
    expect(view.text()).toContain('does not prove that remote tasks have finished')
    view.unmount()
  })
  it('requires exact RESUME proof before reopening access', async () => {
    const view = await loaded(closed)
    await view.get('[data-testid="write-admission-resume"]').trigger('click');await flushPromises()
    expect(view.get('[data-testid="write-admission-confirm"]').attributes('disabled')).toBeDefined()
    await view.get('input').setValue('RESUME')
    vi.mocked(backendRequest).mockResolvedValue({...open,revision:2})
    await view.get('form').trigger('submit');await flushPromises()
    const call = vi.mocked(backendRequest).mock.calls.find(([,init])=>init?.method==='POST')!
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({action:'resume',expected_revision:1,pause_id:closed.pause_id,confirmation:'RESUME'})
    expect(view.find('[role="dialog"]').exists()).toBe(false)
    expect(view.emitted('changed')?.at(-1)).toEqual([false])
    view.unmount()
  })
  it('refuses resume while draining and displays all local ownership counts', async () => {
    const view = await loaded({...closed,state:'draining',active_attempts:2,held_workspace_locks:1})
    expect(view.text()).toContain('2 accepted attempts')
    expect(view.text()).toContain('1 workspace locks')
    expect(view.find('[data-testid="write-admission-resume"]').exists()).toBe(false)
    view.unmount()
  })
  it('recovers a committed pause after a lost response without replaying POST', async () => {
    const view = await loaded()
    vi.mocked(backendRequest).mockImplementation(async (_path, init) => {
      if(init?.method==='POST') throw new Error('Response lost')
      return closed
    })
    await view.get('[data-testid="write-admission-pause"]').trigger('click');await flushPromises()
    expect(vi.mocked(backendRequest).mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1)
    expect(view.text()).toContain('Response lost')
    expect(view.text()).toContain('Closed')
    expect(view.emitted('changed')?.at(-1)).toEqual([true])
    view.unmount()
  })
  it('discards a stale review and dialog when the backend identity changes', async () => {
    const view = await loaded(closed)
    await view.get('[data-testid="write-admission-resume"]').trigger('click');await view.get('input').setValue('RESUME')
    connection.token='bravo';await flushPromises()
    expect(view.find('[role="dialog"]').exists()).toBe(false)
    expect(view.find('[data-testid="write-admission-resume"]').exists()).toBe(false)
    expect(vi.mocked(backendRequest).mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0)
    view.unmount()
  })
  it('ignores old backend responses and never enables controls without owned assignments', async () => {
    let resolve!: (value:unknown)=>void
    vi.mocked(backendRequest).mockResolvedValueOnce({role:'admin'}).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
    const view = mount(Admission,{props:{deploymentId:'run'}})
    await view.get('[data-testid="write-admission-refresh"]').trigger('click');await flushPromises()
    await view.setProps({deploymentId:'other'})
    resolve(closed);await flushPromises()
    expect(view.text()).not.toContain('45000')
    expect(view.find('[data-testid="write-admission-resume"]').exists()).toBe(false)
    view.unmount()
    const unavailable = await loaded({...open,available:false,vm_ids:[]})
    expect(unavailable.text()).toContain('No retained allocation')
    expect(unavailable.find('[data-testid="write-admission-pause"]').exists()).toBe(false)
    unavailable.unmount()
  })
  it('allows viewers to inspect but reserves write controls for administrators', async () => {
    const view = await loaded(closed,'viewer')
    expect(view.text()).toContain('Closed')
    expect(view.text()).toContain('administrator')
    expect(view.find('[data-testid="write-admission-resume"]').exists()).toBe(false)
    view.unmount()
  })
  it('refuses mismatched or ready-claiming responses', async () => {
    for(const state of [{...closed,deployment_id:'other'},{...closed,remote_quiescence_verified:true},{...closed,capacity_borrowing_allowed:true}]) {
      const view = await loaded(state)
      expect(view.find('[data-testid="write-admission-resume"]').exists()).toBe(false)
      expect(view.get('[role="alert"]').text()).toContain('could not be verified')
      view.unmount()
    }
  })
})
