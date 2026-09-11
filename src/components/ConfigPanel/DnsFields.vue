<script setup>
import FormList from '@/components/ui/FormList.vue'
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
// Add DNS zone management
const addDnsZone = () => {
  if (!config.value.zones) config.value.zones = []
  config.value.zones.push({
    name: '',
    type: 'forward',
    description: ''
  })
}

const removeDnsZone = (index) => {
  config.value.zones.splice(index, 1)
}


</script>

<template>
  <FormDivider label="DNS Server Settings" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.recursion"
      label="Enable Recursion"
      type="checkbox"
      icon=""
    />
    <FormField
      v-model="config.dnssec"
      label="DNSSEC"
      type="checkbox"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.forwarders"
      label="Forwarders"
      type="text"
      placeholder="8.8.8.8, 1.1.1.1"
      hint="Comma-separated list of upstream DNS servers"
      icon=""
    />
  </FormSection>

  <!-- DNS Zone Management -->
  <FormDivider label="DNS Zones" icon="" />

  <FormList
    :items="config.zones || []"
    add-label="Add Zone"
    empty-text="No DNS zones configured"
    empty-hint="Click 'Add Zone' to create a DNS zone"
    @add="addDnsZone"
    @remove="removeDnsZone"
  >
    <template #header>
      <span class="font-medium text-sm">Zones</span>
    </template>
    <template #item="{ item: zone }">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pr-8">
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Zone Name</span></label>
          <input v-model="zone.name" type="text" class="input input-bordered input-sm" placeholder="example.com" />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Type</span></label>
          <select v-model="zone.type" class="select select-bordered select-sm">
            <option value="forward">Forward</option>
            <option value="reverse">Reverse</option>
          </select>
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Description</span></label>
          <input v-model="zone.description" type="text" class="input input-bordered input-sm" placeholder="Zone description" />
        </div>
      </div>
    </template>
  </FormList>
</template>
