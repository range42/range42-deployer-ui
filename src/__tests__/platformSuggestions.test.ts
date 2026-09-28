import { expect, it } from 'vitest'
import type { ProjectDraft } from '@/types/project'
const load = async () => await import('@/services/platformSuggestions').catch(() => ({})) as typeof import('@/services/platformSuggestions')
const project: ProjectDraft = { id:'p',name:'Lab',nodes:[{id:'vm',type:'vm',data:{config:{vmid:31012}}}],edges:[],attachments:[],scenario:{networks:[{vnet:'r42alpha',subnet:'10.80.0.0/23'}]} }
it('suggests full consecutive ranges excluding live guests, templates and project assignments', async () => {
  const api=await load();expect(api.suggestStackSettings).toBeTypeOf('function')
  const result=api.suggestStackSettings(project,{vmids:[31000,31007],vnets:['r42alph1'],subnets:['10.80.2.0/24']},11,'alpha')
  expect(result.vmidStarts).toHaveLength(3)
  for(const start of result.vmidStarts) for(const used of [31000,31007,31012]) expect(used<start||used>=start+11).toBe(true)
  expect(result.networks[0]).toEqual({subnet:'10.80.3.0/24',gateway:'10.80.3.1',bridge:'r42alph2'})
})
it('avoids all ranges and networks already allocated to another stack', async () => {
  const api=await load();expect(api.suggestStackSettings).toBeTypeOf('function')
  const p={...project,nodes:[{id:'platform-alpha',type:'range42-stack',data:{config:{plan:{bridge:'r42beta',subnet:'10.80.4.0/22',vms:[{vm_id:31000}]}}}}]}
  const result=api.suggestStackSettings(p,{vmids:[],vnets:[],subnets:[]},5,'beta')
  expect(result.vmidStarts[0]).toBeGreaterThan(31000)
  expect(result.networks.every(n=>n.bridge!=='r42beta'&&!/^10\.80\.[4-7]\./.test(n.subnet))).toBe(true)
})
