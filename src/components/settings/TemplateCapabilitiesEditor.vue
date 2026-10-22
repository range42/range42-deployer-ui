<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import type {TemplateCapability} from '@/services/provisioning'
const emit=defineEmits<{change:[value:Record<string,TemplateCapability>|null]}>()
const props=defineProps<{disabled?:boolean}>()
const blank=()=>({key:crypto.randomUUID(),role:'',vm_id:'',memory_mib:'',cores:'',disks_gib:''})
const rows=ref([blank()])
const fields=[['role','Template role','text'],['vm_id','Destination VMID','number'],['memory_mib','Memory (MiB)','number'],['cores','vCPUs','number'],['disks_gib','SCSI disk sizes (GiB, comma separated)','text']] as const
const valid=computed(()=>{
  const result:Record<string,TemplateCapability>={}
  for(const row of rows.value){
    const id=Number(row.vm_id),memory=Number(row.memory_mib),cores=Number(row.cores)
    const sizes=row.disks_gib.split(',').map(part=>Number(part.trim()))
    if(!/^[a-z][a-z0-9-]{0,31}$/.test(row.role)||Object.hasOwn(result,row.role)||!Number.isSafeInteger(id)||id<1000||id>999999999
      ||!Number.isSafeInteger(memory)||memory<128||memory>4194304||!Number.isSafeInteger(cores)||cores<1||cores>256
      ||sizes.length>2||sizes.some(size=>!Number.isSafeInteger(size)||size<1||size>65536))return null
    result[row.role]={vm_id:id,memory_mib:memory,cores,disks_gib:sizes}
  }
  if(new Set(Object.values(result).map(row=>row.vm_id)).size!==rows.value.length)return null
  return result
})
watch(valid,value=>emit('change',value),{immediate:true,deep:true,flush:'sync'})
</script>
<template>
  <fieldset :disabled="props.disabled" class="min-w-0 space-y-3 rounded border border-base-300 p-3" data-testid="template-capabilities-editor">
    <legend class="font-medium">Approved reusable templates</legend>
    <p class="text-sm">Name each template role and its exact output hardware. Source VMIDs are selected when deploying a preparation recipe. The node’s optional module must approve the same resources.</p>
    <fieldset v-for="(row,index) in rows" :key="row.key" class="min-w-0 rounded border border-base-300 p-3">
      <legend class="text-sm font-medium">Template {{ index+1 }}</legend>
      <div class="grid gap-3 sm:grid-cols-2">
        <label v-for="[field,label,type] in fields" :key="field" class="form-control gap-1"><span class="text-sm">{{ label }}</span>
          <input v-model="row[field]" :type="type" required class="input input-bordered w-full" :data-testid="`template-${index}-${field}`" />
        </label>
      </div>
      <button type="button" :disabled="rows.length===1" class="btn btn-ghost btn-sm mt-2" :aria-label="`Remove template ${index+1}`" @click="rows.splice(index,1)">Remove template</button>
    </fieldset>
    <button type="button" :disabled="rows.length>=16" class="btn btn-outline btn-sm" data-testid="add-template-capability" @click="rows.push(blank())">Add template</button>
    <p v-if="!valid" class="text-sm" role="status">Complete all template fields with distinct roles and VMIDs to review this profile.</p>
  </fieldset>
</template>
