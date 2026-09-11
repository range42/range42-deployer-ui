<script setup>
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormDivider label="Segment Type" icon="" />

  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.segmentType"
      label="Network Zone Type"
      type="select"
      :required="true"
      :options="[
        { value: 'wan', label: 'WAN - External/Internet facing' },
        { value: 'dmz', label: 'DMZ - Demilitarized zone' },
        { value: 'lan', label: 'LAN - Internal network' },
        { value: 'management', label: 'Management - Admin/OOB access' },
        { value: 'custom', label: 'Custom - User defined' }
      ]"
      hint="Defines the security zone purpose"
      icon=""
    />
    <FormField
      v-model="config.description"
      label="Description"
      type="textarea"
      placeholder="Network segment description..."
      :rows="2"
      icon=""
    />
  </FormSection>

  <FormDivider label="Proxmox Bridge Configuration" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.bridge"
      label="Proxmox Bridge"
      type="text"
      :required="true"
      placeholder="vmbr0"
      hint="Bridge name (must exist on Proxmox node)"
      icon=""
    />
    <FormField
      v-model="config.vlan"
      label="VLAN Tag"
      type="number"
      placeholder="Optional (1-4094)"
      :min="1"
      :max="4094"
      hint="802.1Q VLAN ID (optional)"
      icon=""
    />
  </FormSection>

  <FormDivider label="IP Addressing (Planning)" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.cidr"
      :label="t('configPanel.fields.cidr')"
      type="text"
      :placeholder="t('configPanel.placeholders.cidr')"
      hint="Network range in CIDR notation"
      icon=""
    />
    <FormField
      v-model="config.gateway"
      :label="t('configPanel.fields.gateway')"
      type="text"
      :placeholder="t('configPanel.placeholders.gateway')"
      hint="Default gateway IP for this segment"
      icon=""
    />
  </FormSection>
</template>
