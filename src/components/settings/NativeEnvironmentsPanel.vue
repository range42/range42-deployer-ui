<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import EnvironmentProfileReview, {type ReviewedEnvironmentProfile} from './EnvironmentProfileReview.vue'
import GatewayFoundationReview, {type GatewayFoundation, type GatewayNicCapacity} from './GatewayFoundationReview.vue'
import PhysicalNodeIdentity from './PhysicalNodeIdentity.vue'

type Base = {id: string; label: string; target_node: string; target_api_url: string; ready: boolean; issues: string[]}
type Target = {id: string; name: string; api_url: string; node_name: string}
type RuntimeTarget = {version:1;physical_node_id:string;hardware_binding:string;node_name:string;installation_id:string}
type Environment = {id: string; label: string; ready_for_planning: boolean; issues: string[]; workshop_profile?: ReviewedEnvironmentProfile; runtime_target?:RuntimeTarget|null; gateway_foundation?: GatewayFoundation | null; gateway_nic_capacity?: GatewayNicCapacity | null}
type Review = {runtime_target?:RuntimeTarget|null;revision: string; workshop_profile: ReviewedEnvironmentProfile; requirements: string[]; infrastructure_qualified: boolean; gateway_foundation?: GatewayFoundation | null; gateway_nic_capacity?: GatewayNicCapacity | null}
const emit = defineEmits<{dirty: [value: boolean]}>()
const backend = useBackendApiStore()
const items=ref<Environment[]>([]), bases=ref<Base[]>([]), targets=ref<Target[]>([])
const loaded=ref(false), busy=ref(false), role=ref(''), error=ref(''), notice=ref('')
const rotatingTarget=ref<Target|null>(null), rotationRevision=ref(''), rotationCredential=ref('')
const rotationInput=ref<HTMLInputElement|null>(null)
const editing=ref(false), addingTarget=ref(false), reviewed=ref<Review|null>(null), revalidating=ref('')
const initial = () => ({label:'',base_context_id:'',target_host_id:'',profile_id:'',vmid_start:'',vmid_end:'',network_pool:'',network_count:'10',bridge_start:'',proxmox_template:'',deployer_template:'',storage:'',reuse_runtime:false,managed_gateway:false,gateway_management_bridge:'',gateway_management_subnet:''})
const form=ref(initial())
const target=ref({name:'',api_url:'',node_name:'',token_ref:''})
const gatewayVmids=ref(''), gatewayFoundation=ref<GatewayFoundation|null>(null), gatewayCapacity=ref<GatewayNicCapacity|null>(null)
let generation=0, controller: AbortController|null=null
const dirty=computed(()=>editing.value||addingTarget.value||!!rotatingTarget.value)
watch(dirty,value=>emit('dirty',value))
watch(form,()=>{reviewed.value=null;gatewayFoundation.value=null;gatewayCapacity.value=null}, {deep:true,flush:'sync'})
watch(gatewayVmids,()=>{reviewed.value=null;gatewayFoundation.value=null;gatewayCapacity.value=null},{flush:'sync'})
function reset() {
  generation++;controller?.abort();controller=null
  items.value=[];bases.value=[];targets.value=[];loaded.value=false;busy.value=false;role.value=''
  error.value='';notice.value='';editing.value=false;addingTarget.value=false;reviewed.value=null;revalidating.value=''
  rotatingTarget.value=null;rotationRevision.value='';rotationCredential.value=''
  form.value=initial();target.value={name:'',api_url:'',node_name:'',token_ref:''};gatewayVmids.value='';gatewayFoundation.value=null;gatewayCapacity.value=null
}
watch(()=>JSON.stringify([backend.activeHost?.id,getBackendScope(),backend.token]),reset,{flush:'sync'})
onBeforeUnmount(reset)
const active=(request: number)=>request===generation
function fail(cause: unknown, request: number) {if(active(request))error.value=cause instanceof Error?cause.message:'The environment request failed. Refresh and retry.'}
async function load() {
  if(busy.value)return
  const request=generation;busy.value=true;error.value='';controller=new AbortController()
  try {
    const identity=await backendRequest<{role:string}>('/v1/auth/me',{signal:controller.signal})
    if(!active(request))return
    role.value=identity.role
    if(identity.role!=='admin')throw new Error('Administrator access is required to register provisioning environments.')
    const [environments,hosts]=await Promise.all([
      backendRequest<{items:Environment[];base_contexts:Base[]}>('/v1/environments',{signal:controller.signal}),
      backendRequest<{items:Target[]}>('/v1/proxmox/hosts',{signal:controller.signal}),
    ])
    if(!active(request))return
    items.value=environments.items;bases.value=environments.base_contexts;targets.value=hosts.items;loaded.value=true
  }catch(cause){fail(cause,request)}finally{if(active(request))busy.value=false}
}
function newEnvironment() {
  form.value=initial();gatewayVmids.value='';gatewayFoundation.value=null;gatewayCapacity.value=null
  if(bases.value.length===1)form.value.base_context_id=bases.value[0]!.id
  if(targets.value.length===1)form.value.target_host_id=targets.value[0]!.id
  reviewed.value=null;revalidating.value='';editing.value=true;notice.value='';error.value=''
}
function integer(value:string,min:number,max:number,label:string) {
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)throw new Error(`${label} must be an integer from ${min} to ${max}.`)
  return Number(value)
}
function gatewayIds() {
  if(!gatewayVmids.value.trim())return []
  const ids=gatewayVmids.value.split(',').map(value=>integer(value.trim(),100,999999999,'Infrastructure VM ID'))
  if(ids.length!==1)throw new Error('Choose one retained gateway VM ID for this environment.')
  return ids
}
function selection(allowUnobservedInfrastructure=false) {
  const value=form.value
  const ids=gatewayIds()
  if(ids.length&&!allowUnobservedInfrastructure&&gatewayFoundation.value?.vmid!==ids[0])throw new Error('Inspect the selected gateway again before reviewing this environment.')
  if(!value.label.trim()||!value.base_context_id||!value.target_host_id||!/^([a-z][a-z0-9-]{0,63})$/.test(value.profile_id))throw new Error('Choose a runtime and target, and enter an environment name and a lowercase profile identifier.')
  const start=integer(value.vmid_start,1000,999999999,'First VM ID'),end=integer(value.vmid_end,start,Math.min(start+4095,999999999),'Last VM ID')
  const count=integer(value.network_count,1,64,'Participant networks'),bridge=integer(value.bridge_start,1,99999999999-63,'First bridge number')
  const match=/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(value.network_pool)
  if(!match)throw new Error('Enter an aligned private IPv4 network, for example 10.79.0.0/23.')
  const octets=match.slice(1,5).map(Number),prefix=Number(match[5]),address=octets.reduce((sum,part)=>sum*256+part,0)
  if(octets.some(part=>part>255)||prefix<16||prefix>28||address%2**(32-prefix)!==0||count*16>2**(32-prefix)
    ||!(octets[0]===10||(octets[0]===172&&octets[1]!>=16&&octets[1]!<=31)||(octets[0]===192&&octets[1]===168)))throw new Error('Use an aligned private /16–/28 pool with enough /28 networks for the selected count.')
  const ip=(value:number)=>[24,16,8,0].map(shift=>Math.floor(value/2**shift)%256).join('.')
  let managedGateway: {management_bridge:string;management_subnet:string}|undefined
  if(value.managed_gateway){
    if(ids.length)throw new Error('Choose either one managed gateway per run or a retained shared gateway.')
    const match=/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/29$/.exec(value.gateway_management_subnet)
    if(!match||!/^vmbr[1-9][0-9]{2,10}$/.test(value.gateway_management_bridge))throw new Error('Enter a gateway management bridge and an aligned private /29 subnet.')
    const parts=match.slice(1).map(Number),first=parts.reduce((sum,part)=>sum*256+part,0)
    if(parts.some(part=>part>255)||first%8!==0||!(parts[0]===10||(parts[0]===172&&parts[1]!>=16&&parts[1]!<=31)||(parts[0]===192&&parts[1]===168))
      ||(first<=address+count*16-1&&first+7>=address)||Array.from({length:count},(_,index)=>`vmbr${bridge+index}`).includes(value.gateway_management_bridge))throw new Error('Gateway management must use a separate private /29 and bridge outside participant networks.')
    managedGateway={management_bridge:value.gateway_management_bridge,management_subnet:value.gateway_management_subnet}
  }
  return {label:value.label.trim(),base_context_id:value.base_context_id,target_host_id:value.target_host_id,
    workshop_profile:{version:1,id:value.profile_id,vmid_ranges:[[start,end]],
      networks:Array.from({length:count},(_,index)=>({bridge:`vmbr${bridge+index}`,subnet:`${ip(address+16*index)}/28`,gateway:ip(address+16*index+1)})),
      proxmox_template:integer(value.proxmox_template,100,999999999,'Proxmox template'),deployer_template:integer(value.deployer_template,100,999999999,'Deployer template'),storage:value.storage.trim(),...(managedGateway?{managed_gateway:managedGateway}:{})},...(value.reuse_runtime?{reuse_runtime:true}:{}),...(!allowUnobservedInfrastructure&&gatewayFoundation.value?{gateway_foundation:gatewayFoundation.value}:{})}
}
async function inspectInfrastructure() {
  const request=generation;error.value='';reviewed.value=null
  try {
    const vmids=gatewayIds()
    if(!vmids.length)throw new Error('Choose a retained gateway VM ID.')
    const payload=selection(true);busy.value=true
    const result=await backendRequest<{gateway_foundation:GatewayFoundation;nic_capacity:GatewayNicCapacity;infrastructure_qualified:false}>('/v1/environments/foundation/review',{method:'POST',body:JSON.stringify({...payload,vmid:vmids[0]})})
    if(!active(request))return
    if(result.gateway_foundation.vmid!==vmids[0]||result.infrastructure_qualified!==false||result.nic_capacity.remaining_after_preparation<0)throw new Error('The gateway inspection does not match the selected VM or available NIC slots.')
    gatewayFoundation.value=result.gateway_foundation;gatewayCapacity.value=result.nic_capacity
  }catch(cause){if(active(request)){gatewayFoundation.value=null;gatewayCapacity.value=null}fail(cause,request)}finally{if(active(request))busy.value=false}
}
async function review() {
  const request=generation;error.value='';notice.value='';reviewed.value=null
  try {
    const payload=selection();busy.value=true
    const result=await backendRequest<Review>('/v1/environments/review',{method:'POST',body:JSON.stringify(payload)})
    if(active(request))reviewed.value=result
  }catch(cause){fail(cause,request)}finally{if(active(request))busy.value=false}
}
async function save() {
  if(!reviewed.value||busy.value)return
  const request=generation;busy.value=true;error.value=''
  try {
    await backendRequest('/v1/environments',{method:'POST',body:JSON.stringify({...selection(),review_revision:reviewed.value.revision})})
    if(!active(request))return
    editing.value=false;reviewed.value=null;notice.value='Environment registered. Open Deploy to choose it and review a run’s live preflight.'
    busy.value=false;await load()
  }catch(cause){
    if(active(request)){
      reviewed.value=null;gatewayFoundation.value=null;gatewayCapacity.value=null
      busy.value=false;await load()
      if(active(request)){notice.value='Check the registered environment list before retrying the save.';fail(cause,request)}
    }
  }finally{if(active(request))busy.value=false}
}
async function registerTarget() {
  const request=generation;error.value=''
  try {
    const url=new URL(target.value.api_url)
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use the verified HTTPS Proxmox API origin, including its port.')
    if(!target.value.name.trim()||!target.value.node_name.trim()||!/^\S+!\S+=\S+$/.test(target.value.token_ref))throw new Error('Enter a target name, node and user!token-id=secret API credential.')
    if(targets.value.some(host=>host.name===target.value.name.trim()))throw new Error('Choose a new target name. Existing target credentials require an explicit rotation.')
    const payload={...target.value,api_url:url.origin,name:target.value.name.trim(),node_name:target.value.node_name.trim()}
    target.value.token_ref='';busy.value=true
    const created=await backendRequest<Target>('/v1/proxmox/hosts',{method:'POST',body:JSON.stringify(payload)})
    if(!active(request))return
    targets.value=[...targets.value.filter(item=>item.id!==created.id),created]
    form.value.target_host_id=created.id;addingTarget.value=false;notice.value='Dedicated target registered. Review its environment bounds before use.'
  }catch(cause){fail(cause,request)}finally{if(active(request)){target.value.token_ref='';busy.value=false}}
}
async function reviewCredential(host:Target) {
  if(busy.value||dirty.value)return
  const request=generation;busy.value=true;error.value='';notice.value=''
  try {
    const result=await backendRequest<{revision:string;host:Target}>(`/v1/proxmox/hosts/${encodeURIComponent(host.id)}/credential/review`,{method:'POST'})
    if(!active(request))return
    if(!/^[a-f0-9]{64}$/.test(result.revision)||result.host.id!==host.id||result.host.name!==host.name||result.host.node_name!==host.node_name||new URL(result.host.api_url).origin!==new URL(host.api_url).origin)throw new Error('The target changed. Refresh the registered targets before replacing its credential.')
    reviewed.value=null;revalidating.value='';rotatingTarget.value=host;rotationRevision.value=result.revision;rotationCredential.value=''
  }catch(cause){fail(cause,request)}finally{if(active(request)){busy.value=false;await nextTick();if(active(request)&&rotatingTarget.value?.id===host.id)rotationInput.value?.focus()}}
}
function cancelCredentialRotation() {
  if(busy.value)return
  rotatingTarget.value=null;rotationRevision.value='';rotationCredential.value=''
}
async function rotateCredential() {
  if(busy.value||!rotatingTarget.value||!rotationRevision.value)return
  const request=generation;let submitted=false;error.value=''
  try {
    if(!/^[^\s!@=]+@[^\s!@=]+![^\s!=]+=[^\s]+$/.test(rotationCredential.value))throw new Error('Enter a user@realm!token-id=secret Proxmox API credential.')
    const host=rotatingTarget.value,payload={expected_revision:rotationRevision.value,token_ref:rotationCredential.value}
    rotationCredential.value='';busy.value=true;submitted=true
    await backendRequest(`/v1/proxmox/hosts/${encodeURIComponent(host.id)}/credential`,{method:'PUT',body:JSON.stringify(payload)})
    if(!active(request))return
    rotatingTarget.value=null;rotationRevision.value='';reviewed.value=null;revalidating.value=''
    items.value=[];loaded.value=false;notice.value='Credential replaced. Verify the target connection, then review and revalidate affected environments before planning.'
    busy.value=false;await load()
  }catch(cause){if(active(request)&&submitted)rotationRevision.value='';fail(cause,request)}finally{if(active(request)){rotationCredential.value='';busy.value=false}}
}
async function reviewExisting(id:string) {
  const request=generation;busy.value=true;error.value='';reviewed.value=null
  try {const result=await backendRequest<Review>(`/v1/environments/${encodeURIComponent(id)}/review`,{method:'POST'});if(active(request)){reviewed.value=result;revalidating.value=id}}
  catch(cause){fail(cause,request)}finally{if(active(request))busy.value=false}
}
async function revalidate() {
  if(!reviewed.value||!revalidating.value||busy.value)return
  const request=generation;busy.value=true;error.value=''
  try {
    await backendRequest(`/v1/environments/${encodeURIComponent(revalidating.value)}/revalidate`,{method:'POST',body:JSON.stringify({review_revision:reviewed.value.revision})})
    if(!active(request))return
    reviewed.value=null;revalidating.value='';busy.value=false;notice.value='Environment revalidated.';await load()
  }catch(cause){fail(cause,request)}finally{if(active(request))busy.value=false}
}
const fields=[['label','Environment name','text'],['profile_id','Profile identifier','text'],['vmid_start','First guest VM ID','number'],['vmid_end','Last guest VM ID','number'],['network_pool','Private participant pool','text'],['network_count','Number of participant networks','number'],['bridge_start','First bridge number','number'],['proxmox_template','Proxmox source template ID','number'],['deployer_template','Deployer source template ID','number'],['storage','Target storage','text']] as const
</script>

<template>
  <section id="native-environments" class="rounded-xl border border-base-300 p-5 space-y-4" data-testid="native-environments" aria-labelledby="native-environments-heading">
    <div><h2 id="native-environments-heading" class="font-semibold">Native provisioning environments</h2><p class="text-sm text-base-content/75 mt-2">Register reusable workshop bounds on an installed native runtime. Each run keeps its own machines, networks and credentials.</p></div>
    <p class="text-sm text-base-content/75">Registering a profile enables planning. Source templates, bridge isolation, routing, laptop access and capacity still require live qualification before deployment.</p>
    <p v-if="error" role="alert" class="rounded border-l-4 border-error bg-error/10 p-2 text-sm text-base-content">{{ error }}</p><p v-if="notice" role="status" class="text-sm">{{ notice }}</p>
    <button type="button" class="btn btn-outline btn-sm" :disabled="busy||editing||addingTarget||!!rotatingTarget" data-testid="load-native-environments" @click="load">{{ busy ? 'Loading…' : loaded ? 'Refresh environments' : 'Load environments' }}</button>
    <template v-if="loaded&&role==='admin'">
      <ul class="space-y-3"><li v-for="item in items" :key="item.id" class="rounded border border-base-300 p-3"><p class="font-medium">{{ item.label }}</p><details v-if="item.workshop_profile" class="my-2"><summary class="cursor-pointer text-sm">Recorded environment scope</summary><div class="mt-3 space-y-3"><p v-if="item.runtime_target" data-testid="environment-saved-runtime-target" class="text-sm break-words">Reviewed physical node: {{ item.runtime_target.node_name }}<span class="block font-mono text-xs break-all">{{ item.runtime_target.physical_node_id }}</span></p><EnvironmentProfileReview :profile="item.workshop_profile" /><GatewayFoundationReview v-if="item.gateway_foundation" :foundation="item.gateway_foundation" :capacity="item.gateway_nic_capacity" /></div></details><p class="text-sm">{{ item.ready_for_planning ? 'Available for planning · Live preflight required' : 'Review required' }}</p><p v-for="issue in item.issues" :key="issue" class="rounded border-l-4 border-warning bg-warning/10 p-2 text-sm text-base-content">{{ issue }}</p><button v-if="!item.ready_for_planning" type="button" class="btn btn-sm btn-outline mt-2" :disabled="busy||editing||addingTarget||!!rotatingTarget" @click="reviewExisting(item.id)">Review changed environment</button></li></ul>
      <p v-if="!bases.length" role="status" class="text-sm">No trusted native runtime is registered on this backend. Initialize the deployment runtime and register its node and verified HTTPS endpoint before adding a provisioning profile.</p>
      <div class="flex flex-wrap gap-2"><button type="button" class="btn btn-outline btn-sm" :disabled="busy||editing||addingTarget||!!rotatingTarget||!bases.length" data-testid="new-native-environment" @click="newEnvironment">Register environment</button><button type="button" class="btn btn-outline btn-sm" :disabled="busy||addingTarget||!!rotatingTarget" data-testid="new-environment-target" @click="addingTarget=true">Register dedicated Proxmox target</button></div>
      <details v-if="targets.length" class="rounded border border-base-300 p-3"><summary class="cursor-pointer font-medium">Replace a stored Proxmox credential</summary><p class="mt-2 text-sm">Use a replacement token issued in Proxmox. The target’s address, node, bridge defaults and protected VM IDs are preserved. Affected environment versions require review and revalidation.</p><ul class="mt-3 space-y-2"><li v-for="host in targets" :key="host.id" class="flex flex-wrap items-center gap-3"><span class="text-sm">{{ host.name }} · {{ host.node_name }}</span><button type="button" class="btn btn-outline btn-sm" :data-testid="`rotate-target-${host.id}`" :disabled="busy||dirty" @click="reviewCredential(host)">Replace credential</button></li></ul></details>
      <form v-if="rotatingTarget" data-testid="target-rotation-form" class="rounded border border-base-300 p-4 space-y-3" @submit.prevent="rotateCredential"><p class="font-medium">Replace credential for {{ rotatingTarget.name }}</p><p class="text-sm">{{ rotatingTarget.node_name }} · {{ rotatingTarget.api_url }}</p><label class="form-control gap-1"><span class="text-sm">Replacement Proxmox API credential</span><input ref="rotationInput" v-model="rotationCredential" data-testid="target-rotation-credential" type="password" autocomplete="new-password" class="input input-bordered w-full" :disabled="busy||!rotationRevision" required /></label><p class="text-xs">The backend encrypts this credential. It is cleared after submission or cancellation and is never saved in browser settings.</p><p v-if="!rotationRevision" role="status" class="text-sm">Cancel and review the current target again before retrying.</p><div class="flex gap-2"><button type="submit" class="btn btn-primary btn-sm" :disabled="busy||!rotationRevision" data-testid="submit-target-rotation">Replace credential</button><button type="button" class="btn btn-ghost btn-sm" :disabled="busy" data-testid="cancel-target-rotation" @click="cancelCredentialRotation">Cancel</button></div></form>
      <form v-if="addingTarget" data-testid="environment-target-form" class="space-y-3 rounded border border-base-300 p-4" @submit.prevent="registerTarget"><fieldset :disabled="busy" class="grid gap-3 sm:grid-cols-2"><legend class="font-medium mb-2">Dedicated target credential</legend><label v-for="[key,label,type] in ([['name','Target name','text'],['api_url','HTTPS API origin','url'],['node_name','Proxmox node','text'],['token_ref','Proxmox API credential','password']] as const)" :key="key" class="form-control gap-1"><span class="text-sm">{{ label }}</span><input v-model="target[key]" :type="type" :data-testid="`environment-target-${key}`" class="input input-bordered w-full" :autocomplete="key==='token_ref'?'new-password':'off'" required /></label></fieldset><p class="text-xs">The backend stores this credential. It is cleared from this form after submission and is never saved in browser settings.</p><div class="flex gap-2"><button type="submit" class="btn btn-primary btn-sm" :disabled="busy" data-testid="register-environment-target">Register target</button><button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="addingTarget=false;target.token_ref=''">Cancel</button></div></form>
      <form v-if="editing" data-testid="native-environment-form" class="space-y-4 rounded border border-base-300 p-4" @submit.prevent="review"><fieldset :disabled="busy" class="grid gap-3 sm:grid-cols-2"><legend class="font-medium mb-2">Provisioning bounds</legend><label class="form-control gap-1"><span class="text-sm">Trusted native runtime</span><select v-model="form.base_context_id" class="select select-bordered w-full" data-testid="environment-base_context_id" required><option disabled value="">Choose a runtime</option><option v-for="base in bases" :key="base.id" :value="base.id" :disabled="!base.ready">{{ base.label }} · {{ base.target_node }}</option></select></label><label class="form-control gap-1"><span class="text-sm">Dedicated Proxmox target</span><select v-model="form.target_host_id" class="select select-bordered w-full" data-testid="environment-target_host_id" required><option disabled value="">Choose a target</option><option v-for="host in targets" :key="host.id" :value="host.id">{{ host.name }} · {{ host.node_name }}</option></select></label><label v-for="[key,label,type] in fields" :key="key" class="form-control gap-1"><span class="text-sm">{{ label }}</span><input v-model="form[key]" :type="type" :data-testid="`environment-${key}`" class="input input-bordered w-full" required /></label></fieldset>
        <fieldset class="rounded border border-base-300 p-3 space-y-3">
          <legend class="font-medium">Gateway preparation</legend>
          <label class="flex items-start gap-3"><input v-model="form.managed_gateway" data-testid="environment-managed-gateway" type="checkbox" class="checkbox checkbox-sm" :disabled="busy" /><span class="text-sm">Prepare one managed gateway per run</span></label>
          <p class="text-xs">Each run reserves its gateway with its participant VMs. Enabling this policy still requires the installation’s native preparation capability.</p>
          <template v-if="form.managed_gateway">
            <label class="form-control gap-1"><span class="text-sm">Gateway management bridge</span><input v-model="form.gateway_management_bridge" data-testid="environment-gateway-management-bridge" class="input input-bordered w-full" placeholder="vmbr550" :disabled="busy" required /></label>
            <label class="form-control gap-1"><span class="text-sm">Gateway management subnet</span><input v-model="form.gateway_management_subnet" data-testid="environment-gateway-management-subnet" class="input input-bordered w-full" placeholder="10.78.255.0/29" :disabled="busy" required /></label>
          </template>
        </fieldset>
        <fieldset class="min-w-0 rounded border border-base-300 p-3 space-y-2" :disabled="busy">
          <legend class="font-medium">Runtime target</legend>
          <label class="flex items-start gap-3"><input v-model="form.reuse_runtime" type="checkbox" class="checkbox checkbox-sm" data-testid="environment-reuse-runtime" /><span class="text-sm">Use this installed runtime for the selected reviewed node</span></label>
          <p class="text-xs">The original workspace is retained. This option requires a recorded physical-node identity and matching service configuration for the selected target. Preparing infrastructure and enabling execution are separate steps.</p>
        </fieldset>
        <PhysicalNodeIdentity v-if="form.target_host_id" :host-id="form.target_host_id" :disabled="busy" />
        <fieldset :disabled="busy" class="space-y-2"><legend class="text-sm font-medium">Retained gateway (optional)</legend><label class="form-control gap-1"><span class="text-sm">Gateway VM ID</span><input v-model="gatewayVmids" type="text" class="input input-bordered w-full" data-testid="environment-gateway-vmids" placeholder="For example, 3001" /></label><p class="text-xs text-base-content/75">Select the existing managed gateway before attaching its future participant ports. Inspection records its original generation, current ports and available NIC slots. Run reset and retirement retain this infrastructure.</p><button type="button" class="btn btn-outline btn-sm" :disabled="busy||!gatewayVmids.trim()" data-testid="inspect-environment-infrastructure" @click="inspectInfrastructure">Inspect infrastructure</button><p v-if="gatewayFoundation" role="status" class="text-sm">Current and pending gateway configuration match. Inspect again after changing this environment’s inputs.</p><GatewayFoundationReview v-if="gatewayFoundation" :foundation="gatewayFoundation" :capacity="gatewayCapacity" /></fieldset>
        <p class="text-sm">Each participant network is a separate /28, with its first address as gateway. This records approved bounds; it does not create bridges or modify source templates. Saved bounds are versioned: register another environment to change them.</p>
        <div v-if="reviewed&&!revalidating" class="rounded bg-base-200 p-3 space-y-2" data-testid="environment-reviewed"><p class="font-medium">Configuration reviewed · Live infrastructure preflight required</p><p v-if="reviewed.runtime_target" data-testid="environment-reviewed-runtime-target" class="text-sm break-words">Reviewed physical node: {{ reviewed.runtime_target.node_name }}<span class="block font-mono text-xs break-all">{{ reviewed.runtime_target.physical_node_id }}</span></p><EnvironmentProfileReview :profile="reviewed.workshop_profile" /><GatewayFoundationReview v-if="revalidating&&reviewed.gateway_foundation" :foundation="reviewed.gateway_foundation" :capacity="reviewed.gateway_nic_capacity" /><p v-for="requirement in reviewed.requirements" :key="requirement" class="text-sm">{{ requirement }}</p><button type="button" class="btn btn-primary btn-sm" :disabled="busy" data-testid="save-native-environment" @click="save">Save reviewed environment</button></div>
        <div class="flex gap-2"><button type="submit" class="btn btn-outline btn-sm" :disabled="busy" data-testid="review-native-environment">Review configuration</button><button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="editing=false;reviewed=null">Cancel</button></div>
      </form>
      <div v-if="revalidating&&reviewed" class="rounded border border-base-300 p-4 space-y-3"><p class="font-medium">Revalidate the existing environment with its current credential and trusted runtime.</p><p v-if="reviewed.runtime_target" data-testid="environment-reviewed-runtime-target" class="text-sm break-words">Reviewed physical node: {{ reviewed.runtime_target.node_name }}<span class="block font-mono text-xs break-all">{{ reviewed.runtime_target.physical_node_id }}</span></p><EnvironmentProfileReview :profile="reviewed.workshop_profile" /><GatewayFoundationReview v-if="revalidating&&reviewed.gateway_foundation" :foundation="reviewed.gateway_foundation" :capacity="reviewed.gateway_nic_capacity" /><p v-for="requirement in reviewed.requirements" :key="requirement" class="text-sm">{{ requirement }}</p><button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="revalidate">Confirm revalidation</button><button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="revalidating='';reviewed=null">Cancel</button></div>
    </template>
  </section>
</template>
