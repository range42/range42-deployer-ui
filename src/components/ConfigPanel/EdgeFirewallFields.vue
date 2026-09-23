<script setup>
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.description"
      label="Description"
      type="textarea"
      placeholder="Edge firewall description..."
      :rows="2"
      icon=""
    />
    <FormField
      v-model="config.applianceType"
      label="Appliance Type"
      type="select"
      :options="[
        { value: 'pfsense', label: 'pfSense' },
        { value: 'opnsense', label: 'OPNsense' }
      ]"
      hint="Firewall appliance type"
      icon=""
    />
  </FormSection>
</template>
