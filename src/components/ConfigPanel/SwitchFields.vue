<script setup>
import FormList from '@/components/ui/FormList.vue'
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
// Add VLAN management for switches
const addVlan = () => {
  if (!config.value.vlans) config.value.vlans = []
  config.value.vlans.push({
    id: config.value.vlans.length + 1,
    name: `VLAN_${config.value.vlans.length + 1}`,
    description: ''
  })
}

const removeVlan = (index) => {
  config.value.vlans.splice(index, 1)
}


</script>

<template>
  <FormDivider label="Switch Configuration" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.bridge"
      label="Backing Proxmox Bridge"
      type="select"
      :options="[
        { value: '', label: 'None (Logical only)' },
        { value: 'vmbr0', label: 'vmbr0' },
        { value: 'vmbr1', label: 'vmbr1' },
        { value: 'vmbr2', label: 'vmbr2' },
        { value: 'vmbr3', label: 'vmbr3' }
      ]"
      hint="Optional bridge for VLAN trunking"
      icon=""
    />
    <FormField
      v-model="config.portCount"
      label="Port Count"
      type="select"
      :required="true"
      :options="[
        { value: 8, label: '8 ports' },
        { value: 16, label: '16 ports' },
        { value: 24, label: '24 ports' },
        { value: 48, label: '48 ports' }
      ]"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.managementVlan"
      label="Management VLAN"
      type="number"
      placeholder="e.g., 1"
      :min="1"
      :max="4094"
      icon=""
    />
    <FormField
      v-model="config.trunkPortsInput"
      label="Trunk Ports"
      type="text"
      placeholder="e.g., 1,2,24"
      hint="Comma-separated list of trunk ports"
      icon=""
    />
  </FormSection>

  <!-- VLAN Management -->
  <FormDivider label="VLAN Configuration" icon="" />

  <FormList
    :items="config.vlans || []"
    add-label="Add VLAN"
    empty-text="No VLANs configured"
    empty-hint="Click 'Add VLAN' to create one"
    @add="addVlan"
    @remove="removeVlan"
  >
    <template #header>
      <span class="font-medium text-sm">VLANs</span>
    </template>
    <template #item="{ item: vlan }">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pr-8">
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">VLAN ID</span></label>
          <input
            v-model.number="vlan.id"
            type="number"
            class="input input-bordered input-sm"
            placeholder="1-4094"
            min="1"
            max="4094"
          />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Name</span></label>
          <input
            v-model="vlan.name"
            type="text"
            class="input input-bordered input-sm"
            placeholder="VLAN Name"
          />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Subnet</span></label>
          <input
            v-model="vlan.subnet"
            type="text"
            class="input input-bordered input-sm"
            placeholder="10.0.10.0/24"
          />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Gateway</span></label>
          <input
            v-model="vlan.gateway"
            type="text"
            class="input input-bordered input-sm"
            placeholder="10.0.10.1"
          />
        </div>
      </div>
    </template>
  </FormList>
</template>
