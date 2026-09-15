<script setup>
import { computed } from 'vue'
import { vmMemoryMb, setVmMemoryMb, setVmDiskSize } from '@/services/vmResources'
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const config = defineModel({ type: Object, required: true })
defineProps({ availableTemplates: { type: Array, default: () => [] }, availableStorages: { type: Array, default: () => [] }, loadingTemplates: Boolean })
const emit = defineEmits(['refresh-templates', 'select-template'])
const memory = computed({ get: () => vmMemoryMb(config.value), set: value => setVmMemoryMb(config.value, value) })
const diskSize = computed({
  get: () => Object.hasOwn(config.value, 'disk_gb')
    ? config.value.disk_gb == null || config.value.disk_gb === '' ? '' : `${config.value.disk_gb}G`
    : config.value.diskSize,
  set: value => setVmDiskSize(config.value, value),
})
</script>

<template>
  <FormDivider label="Virtual Machine" icon="" />

  <FormSection title="Template" icon="" variant="bordered" :columns="1">
    <p v-if="config.os" class="text-sm text-base-content/70">{{ t('configPanel.templateRequirement', { os: config.os }) }}</p>
    <div class="flex items-end gap-2">
      <div class="flex-1">
        <FormField
          v-model="config.template"
          @update:model-value="emit('select-template', $event)"
          label="Clone from template"
          type="select"
          :options="availableTemplates"
          :placeholder="loadingTemplates ? 'Loading templates...' : 'Select a template...'"
          :disabled="loadingTemplates"
          hint="Selecting a template auto-fills CPU and RAM (editable)"
          icon=""
        />
      </div>
      <button
        class="btn btn-sm btn-ghost mb-1"
        :class="{ 'loading': loadingTemplates }"
        :disabled="loadingTemplates"
        @click="emit('refresh-templates')"
        :title="t('configPanel.a11y.refreshTemplates')"
        :aria-label="t('configPanel.a11y.refreshTemplates')"
      >
        <svg v-if="!loadingTemplates" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  </FormSection>

  <FormSection title="Resources" icon="" variant="bordered" :columns="3">
    <FormField
      v-model="config.cores"
      label="CPU Cores"
      type="number"
      placeholder="2"
      :min="1"
      :max="32"
      icon=""
    />
    <FormField
      v-model="memory"
      label="Memory (MB)"
      type="number"
      placeholder="2048"
      :min="512"
      hint="Auto-filled from template"
      icon=""
    />
    <FormField
      v-model="diskSize"
      label="Disk"
      type="text"
      placeholder="32G"
      hint="e.g. 16G, 32G, 100G"
      icon=""
    />
  </FormSection>

  <FormSection v-if="availableStorages.length > 0" title="Storage" icon="" variant="bordered" :columns="1">
    <FormField
      v-model="config.storage"
      label="Disk Storage"
      type="select"
      :options="availableStorages"
      placeholder="Use project default"
      hint="Prefills clone destination storage in Scenario configuration. Review and save it there before deployment; it does not move disks of existing guests."
      icon=""
    />
  </FormSection>

  <FormSection title="Cloud-init for new clones" icon="" variant="bordered" :columns="1">
    <p class="text-sm text-base-content/70">These fields prefill Scenario configuration for new clones. Review and save them there before deployment. Keys and passwords come from the backend workspace.</p>
    <FormField v-model="config.ssh_user" label="Guest SSH user" placeholder="alice" />
    <FormField v-model="config.dns_servers" label="DNS servers" placeholder="1.1.1.1" hint="Up to three IPv4 addresses separated by spaces or commas. Blank inherits template DNS." />
    <FormField v-model="config.dns_search_domain" label="DNS search domain" placeholder="Inherit template domain" />
  </FormSection>

  <FormSection title="Network & Details" icon="" variant="bordered" :columns="2">
    <FormField
      v-model="config.ipAddress"
      label="IP Address (optional)"
      type="text"
      placeholder="auto-assign or e.g. 192.168.42.50"
      hint="Leave empty for DHCP or cloud-init default"
      icon=""
    />
    <FormField
      v-model="config.description"
      label="Description"
      type="textarea"
      placeholder="What is this VM for?"
      :rows="2"
      icon=""
    />
  </FormSection>
</template>
