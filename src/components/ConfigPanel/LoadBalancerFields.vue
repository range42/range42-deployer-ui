<script setup>
import FormList from '@/components/ui/FormList.vue'
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
// Add server management for load balancer
const addServer = () => {
  if (!config.value.servers) config.value.servers = []
  config.value.servers.push({
    ip: '',
    port: '',
    weight: 1,
    status: 'active'
  })
}

const removeServer = (index) => {
  config.value.servers.splice(index, 1)
}


</script>

<template>
  <FormDivider label="Load Balancer Settings" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.algorithm"
      label="Load Balancing Algorithm"
      type="select"
      :required="true"
      :options="[
        { value: 'round-robin', label: 'Round Robin' },
        { value: 'least-connections', label: 'Least Connections' },
        { value: 'ip-hash', label: 'IP Hash' },
        { value: 'weighted-round-robin', label: 'Weighted Round Robin' }
      ]"
      icon=""
    />
    <FormField
      v-model="config.healthCheck"
      label="Health Check"
      type="checkbox"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.sslTermination"
      label="SSL Termination"
      type="checkbox"
      icon=""
    />
  </FormSection>

  <!-- Server Pool Management -->
  <FormDivider label="Server Pool" icon="" />

  <FormList
    :items="config.servers || []"
    add-label="Add Server"
    empty-text="No servers configured"
    empty-hint="Click 'Add Server' to add backend servers"
    @add="addServer"
    @remove="removeServer"
  >
    <template #header>
      <span class="font-medium text-sm">Backend Servers</span>
    </template>
    <template #item="{ item: server }">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pr-8">
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Server IP</span></label>
          <input v-model="server.ip" type="text" class="input input-bordered input-sm" placeholder="192.168.1.10" />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Port</span></label>
          <input v-model="server.port" type="text" class="input input-bordered input-sm" placeholder="80" />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Weight</span></label>
          <input v-model.number="server.weight" type="number" class="input input-bordered input-sm" placeholder="1" min="1" />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs opacity-60">Status</span></label>
          <select v-model="server.status" class="select select-bordered select-sm">
            <option value="active">Active</option>
            <option value="backup">Backup</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>
    </template>
  </FormList>
</template>
