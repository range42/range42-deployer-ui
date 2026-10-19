import { beforeEach, expect, it, vi } from 'vitest'
import { loadNativeScenarioFromBackend } from '@/services/nativeScenario'
import { backendRequest } from '@/services/backendApi'
vi.mock('@/services/backendApi', () => ({ backendRequest:vi.fn(),getBackendScope:()=> 'http://backend' }))
const binding={source_id:'source',provider:'github' as const,base_url:'https://github.com',repo_owner:'range42',repo_name:'range42-playbooks',branch:'workshop',branch_strategy:'dedicated_repo' as const}
const snapshot={revision:'a'.repeat(40),path:'scenarios/lab',repository:{owner:'range42',repo:'range42-playbooks',branch:'workshop'},truncated:false,
  files:{'scenarios/lab/main.yml':'---\n- hosts: proxmox\n','scenarios/lab/manifest/scenario_vms.json':'{"vms":[{"vm_id":1250}]}'} }
beforeEach(()=>{vi.clearAllMocks();vi.mocked(backendRequest).mockResolvedValue(structuredClone(snapshot))})
it('opens a native scenario through the authenticated backend without a browser GitHub request',async()=>{
 const result=await loadNativeScenarioFromBackend(binding,'scenarios/lab','a'.repeat(40))
 expect(result.revision.commit_sha).toBe('a'.repeat(40))
 expect(result.files['scenarios/lab/main.yml']).toContain('hosts: proxmox')
 expect(backendRequest).toHaveBeenCalledWith('/v1/catalog/sources/source/native-preview?path=scenarios%2Flab&sha='+ 'a'.repeat(40))
})
it.each(['revision','repository','files'])('rejects mismatched or unscoped backend %s',async field=>{
 const value=structuredClone(snapshot)
 if(field==='revision')value.revision='b'.repeat(40)
 if(field==='repository')value.repository.repo='other'
 if(field==='files')Object.assign(value.files,{'secrets/password.txt':'MUST-NOT-ACCEPT'})
 vi.mocked(backendRequest).mockResolvedValue(value)
 await expect(loadNativeScenarioFromBackend(binding,'scenarios/lab','a'.repeat(40))).rejects.toThrow()
})
