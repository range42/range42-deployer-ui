<script setup>
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormDivider label="Router Configuration" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.description"
      label="Description"
      type="textarea"
      placeholder="Router description..."
      :rows="2"
      icon=""
    />
    <FormField
      v-model="config.applianceType"
      label="Appliance Type"
      type="select"
      :options="[
        { value: 'vyos', label: 'VyOS' },
        { value: 'opnsense', label: 'OPNsense' },
        { value: 'pfsense', label: 'pfSense' }
      ]"
      hint="Virtual router appliance type"
      icon=""
    />
  </FormSection>
</template>
