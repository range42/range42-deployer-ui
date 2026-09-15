<script setup>
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.bridge"
      label="Bridge Name"
      type="text"
      :required="true"
      placeholder="e.g., vmbr100"
      icon=""
    />
    <FormField
      v-model="config.publicCidr"
      label="Public CIDR"
      type="text"
      :required="true"
      placeholder="e.g., 203.0.113.0/24"
      hint="Simulated public IP range"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.fakeDns"
      label="Include Fake DNS (8.8.8.8, 1.1.1.1)"
      type="checkbox"
      icon=""
    />
    <FormField
      v-model="config.fakeServices"
      label="Fake Services"
      type="text"
      placeholder="e.g., cdn, updates, cloud"
      hint="Comma-separated list of simulated services"
      icon=""
    />
  </FormSection>
</template>
