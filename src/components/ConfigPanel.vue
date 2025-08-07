<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps(['node'])
const emit = defineEmits(['close', 'update'])

const config = ref({ ...props.node.data.config })

const isValid = computed(() => {
  switch (props.node.type) {
    case 'vm':
      return config.value.name && config.value.cpu && config.value.memory && config.value.disk
    case 'network':
      return config.value.name && config.value.cidr && config.value.gateway
    case 'docker':
      return config.value.name && config.value.image && config.value.ports
    default:
      return false
  }
})

const handleSave = () => {
  const newStatus = isValid.value ? 'orange' : 'gray'
  emit('update', props.node.id, { config: config.value, status: newStatus })
  emit('close')
}

const handleBackdropClick = (event) => {
  if (event.target === event.currentTarget) {
    emit('close')
  }
}

watch(() => props.node, (newNode) => {
  if (newNode) {
    config.value = { ...newNode.data.config }
  }
}, { immediate: true })
</script>

<template>
  <!-- Modal using DaisyUI classes for proper theme support -->
  <div class="modal modal-open" @click="handleBackdropClick">
    <div class="modal-box w-96 max-w-full" @click.stop>
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold">Configure {{ node.type.toUpperCase() }}</h3>
        <button class="btn btn-sm btn-circle btn-ghost" @click="emit('close')">✕</button>
      </div>

      <!-- Content -->
      <div class="space-y-4">
        <!-- Common Fields -->
        <div class="form-control">
          <label class="label">
            <span class="label-text">Name *</span>
          </label>
          <input
            v-model="config.name"
            type="text"
            class="input input-bordered w-full"
            :placeholder="`Enter ${node.type} name`"
          />
        </div>

        <!-- VM Specific Fields -->
        <template v-if="node.type === 'vm'">
          <div class="form-control">
            <label class="label">
              <span class="label-text">CPU Cores *</span>
            </label>
            <input
              v-model.number="config.cpu"
              type="number"
              class="input input-bordered w-full"
              placeholder="e.g., 2"
              min="1"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Memory *</span>
            </label>
            <input
              v-model="config.memory"
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g., 4GB"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Disk Size *</span>
            </label>
            <input
              v-model="config.disk"
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g., 20GB"
            />
          </div>
        </template>

        <!-- Network Specific Fields -->
        <template v-if="node.type === 'network'">
          <div class="form-control">
            <label class="label">
              <span class="label-text">CIDR Range *</span>
            </label>
            <input
              v-model="config.cidr"
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g., 192.168.1.0/24"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Gateway *</span>
            </label>
            <input
              v-model="config.gateway"
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g., 192.168.1.1"
            />
          </div>
        </template>

        <!-- Docker Specific Fields -->
        <template v-if="node.type === 'docker'">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Docker Image *</span>
            </label>
            <input
              v-model="config.image"
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g., nginx:latest"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Ports *</span>
            </label>
            <input
              v-model="config.ports"
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g., 80:80"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Environment Variables</span>
            </label>
            <textarea
              v-model="config.env"
              class="textarea textarea-bordered w-full"
              placeholder="KEY=value (one per line)"
              rows="3"
            ></textarea>
          </div>
        </template>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <div class="flex justify-between items-center w-full">
          <div class="text-sm">
            <span :class="isValid ? 'text-success' : 'text-warning'">
              {{ isValid ? '✓ Ready to deploy' : '⚠ Missing required fields' }}
            </span>
          </div>
          <div class="space-x-2">
            <button class="btn btn-ghost" @click="emit('close')">Cancel</button>
            <button class="btn btn-primary" @click="handleSave">Save</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>