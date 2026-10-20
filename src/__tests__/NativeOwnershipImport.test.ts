import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import ImportOwnership from '@/components/deployment/NativeOwnershipImport.vue'
import { backendRequest } from '@/services/backendApi'
const connection = reactive({url:'http://test',token:'alpha',activeHost:{id:'first'}})
vi.mock('@/stores/backendApiStore',()=>({useBackendApiStore:()=>connection}))
vi.mock('@/services/backendApi',()=>({backendRequest:vi.fn(),getBackendScope:()=>connection.url}))
const assignment = {instance_id:'user01',vm_id:43010,vm_name:'workshop-user01-pve',nics:[],generation:{owner:'original',vmgenid:'11111111-2222-4333-8444-555555555555',receipt_sha256:'b'.repeat(64),configuration_sha256:'c'.repeat(64)}}
const empty = {deployment_id:'run',phase:'unimported',import_id:null,allocation_id:null,ownership_revision:null,project_sha:null,target_host_id:null,assignments:[],resume_review_revision:null,changed_by:null,capacity_borrowing_allowed:false,remote_quiescence_verified:false}
const pending = {...empty,phase:'claim_saved',import_id:'a'.repeat(32),allocation_id:'d'.repeat(32),ownership_revision:'e'.repeat(64),project_sha:'f'.repeat(40),target_host_id:'host',assignments:[assignment],resume_review_revision:'1'.repeat(64),changed_by:'director'}
const active = {...pending,phase:'active'}
const review = {deployment_id:'run',revision:'1'.repeat(64),witness:{cohort:{id:'run'},assignments:[assignment],review_revision:'e'.repeat(64)},capacity_borrowing_allowed:false,remote_quiescence_verified:false}
beforeEach(()=>{vi.resetAllMocks();connection.token='alpha';connection.url='http://test'})
async function load(state=empty,role='admin') {
  vi.mocked(backendRequest).mockClear()
  vi.mocked(backendRequest).mockImplementation(async path=>path==='/v1/auth/me'?{role}:state)
  const view=mount(ImportOwnership,{props:{deploymentId:'run'}})
  expect(backendRequest).not.toHaveBeenCalled()
  await view.get('[data-testid="ownership-refresh"]').trigger('click');await flushPromises()
  return view
}
describe('existing native ownership handoff',()=>{
  it('reviews original guests then sends only the server review revision',async()=>{
    const view=await load()
    vi.mocked(backendRequest).mockResolvedValue(review)
    await view.get('[data-testid="ownership-review"]').trigger('click');await flushPromises()
    expect(view.text()).toContain('43010');expect(view.text()).toContain('user01')
    vi.mocked(backendRequest).mockResolvedValue(active)
    await view.get('[data-testid="ownership-save"]').trigger('click');await flushPromises()
    const calls=vi.mocked(backendRequest).mock.calls.filter(([path,init])=>init?.method==='POST'&&!path.endsWith('/review'))
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1]!.body as string)).toEqual({review_revision:review.revision})
    expect(view.text()).toContain('Ownership acknowledged')
    expect(view.find('[data-testid="ownership-save"]').exists()).toBe(false)
    expect(view.emitted('changed')?.at(-1)).toEqual(['active']);view.unmount()
  })
  it('recovers a lost import reply by reading status without replaying',async()=>{
    const view=await load()
    vi.mocked(backendRequest).mockResolvedValue(review)
    await view.get('[data-testid="ownership-review"]').trigger('click');await flushPromises()
    vi.mocked(backendRequest).mockImplementation(async (_path,init)=>{
      if(init?.method==='POST')throw new Error('Response lost')
      return pending
    })
    await view.get('[data-testid="ownership-save"]').trigger('click');await flushPromises()
    expect(view.text()).toContain('Response lost')
    expect(view.find('[data-testid="ownership-finish"]').exists()).toBe(true)
    expect(vi.mocked(backendRequest).mock.calls.filter(([path,init])=>init?.method==='POST'&&!path.endsWith('/review'))).toHaveLength(1)
    vi.mocked(backendRequest).mockResolvedValue(active)
    await view.get('[data-testid="ownership-finish"]').trigger('click');await flushPromises()
    const call=vi.mocked(backendRequest).mock.calls.at(-1)!
    expect(JSON.parse(call[1]!.body as string)).toEqual({review_revision:pending.resume_review_revision});view.unmount()
  })
  it('does not fetch privileged ownership data for an operator',async()=>{
    const view=await load(empty,'operator')
    expect(backendRequest).toHaveBeenCalledTimes(1)
    expect(view.text()).toContain('administrator')
    expect(view.find('[data-testid="ownership-review"]').exists()).toBe(false);view.unmount()
  })
  it('discards reviewed ownership and delayed responses on backend changes',async()=>{
    const view=await load()
    let resolve!:(value:unknown)=>void
    vi.mocked(backendRequest).mockImplementation(()=>new Promise(done=>{resolve=done}))
    await view.get('[data-testid="ownership-review"]').trigger('click');await flushPromises()
    connection.token='bravo';await flushPromises();resolve(review);await flushPromises()
    expect(view.text()).not.toContain('43010')
    expect(view.find('[data-testid="ownership-save"]').exists()).toBe(false);view.unmount()
  })
  it('refuses a forged ready claim or mismatched deployment',async()=>{
    const view=await load()
    vi.mocked(backendRequest).mockResolvedValue({...review,capacity_borrowing_allowed:true})
    await view.get('[data-testid="ownership-review"]').trigger('click');await flushPromises()
    expect(view.find('[data-testid="ownership-save"]').exists()).toBe(false)
    expect(view.get('[role="alert"]').text()).toContain('verified');view.unmount()
    const other=await load({...active,deployment_id:'other'})
    expect(other.find('[data-testid="ownership-finish"]').exists()).toBe(false)
    expect(other.get('[role="alert"]').text()).toContain('verified');other.unmount()
  })
  it('keeps released ownership visible without an import or restart control',async()=>{
    const view=await load({...active,phase:'released'})
    expect(view.text()).toContain('retired')
    expect(view.find('[data-testid="ownership-review"]').exists()).toBe(false)
    expect(view.find('[data-testid="ownership-finish"]').exists()).toBe(false);view.unmount()
  })
  it('invalidates acknowledged ownership while refreshing and keeps VM controls closed after a failed read',async()=>{
    const view=await load(active)
    expect(view.emitted('changed')?.at(-1)).toEqual(['active'])
    vi.mocked(backendRequest).mockRejectedValue(new Error('Backend unavailable'))
    await view.get('[data-testid="ownership-refresh"]').trigger('click');await flushPromises()
    expect(view.emitted('changed')?.at(-1)).toEqual([null])
    expect(view.text()).not.toContain('Ownership acknowledged');view.unmount()
  })

})
