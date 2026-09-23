<script setup>
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.targetType"
      label="Target Type"
      type="select"
      :required="true"
      placeholder="Select target..."
      :options="[
        { value: 'dvwa', label: 'DVWA (Web Vulnerabilities)' },
        { value: 'juiceshop', label: 'OWASP Juice Shop' },
        { value: 'metasploitable', label: 'Metasploitable 2/3' },
        { value: 'dvl', label: 'Damn Vulnerable Linux' },
        { value: 'dvcp', label: 'Damn Vulnerable Cloud Platform' },
        { value: 'dvad', label: 'Damn Vulnerable AD' },
        { value: 'custom', label: 'Custom Template' }
      ]"
      icon=""
    />
    <FormField
      v-model="config.template"
      label="Template Name"
      type="text"
      placeholder="Template to clone from"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.cores"
      label="CPU Cores"
      type="number"
      placeholder="2"
      :min="1"
      icon=""
    />
    <FormField
      v-model="config.memory"
      label="Memory (MB)"
      type="number"
      placeholder="2048"
      :min="512"
      icon=""
    />
  </FormSection>
</template>
