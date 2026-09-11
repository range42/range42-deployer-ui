<script setup>
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormDivider label="LXC Container" icon="" />

  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.description"
      label="Description"
      type="textarea"
      placeholder="Container description..."
      :rows="2"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.hostname"
      label="Hostname"
      type="text"
      placeholder="e.g., web-server-01"
      icon=""
    />
    <FormField
      v-model="config.ipAddress"
      label="IP Address"
      type="text"
      placeholder="e.g., 192.168.1.10"
      hint="Static IP for this container"
      icon=""
    />
  </FormSection>
</template>
