<script setup>
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormDivider label="Docker Container" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.image"
      label="Docker Image"
      type="text"
      :required="true"
      placeholder="e.g., nginx:latest"
      hint="Image name with optional tag"
      icon=""
    />
    <FormField
      v-model="config.ports"
      label="Port Mapping"
      type="text"
      :required="true"
      placeholder="e.g., 80:80, 443:443"
      hint="host:container format, comma-separated"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.env"
      label="Environment Variables"
      type="textarea"
      placeholder="KEY=value (one per line)"
      :rows="3"
      icon=""
    />
    <FormField
      v-model="config.network"
      label="Container Network"
      type="select"
      :options="[
        { value: 'bridge', label: 'Bridge (Default)' },
        { value: 'host', label: 'Host Network' },
        { value: 'none', label: 'No Network' },
        { value: 'custom', label: 'Custom Network' }
      ]"
      icon=""
    />
  </FormSection>
</template>
