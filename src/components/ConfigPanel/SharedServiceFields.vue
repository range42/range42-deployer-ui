<script setup>
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.serviceType"
      label="Service Type"
      type="select"
      :required="true"
      placeholder="Select service..."
      :options="[
        { value: 'gitea', label: 'Gitea (Git Server)' },
        { value: 'gitlab', label: 'GitLab' },
        { value: 'mattermost', label: 'Mattermost (Chat)' },
        { value: 'wiki', label: 'Wiki.js' },
        { value: 'keycloak', label: 'Keycloak (SSO)' },
        { value: 'registry', label: 'Docker Registry' },
        { value: 'vault', label: 'HashiCorp Vault' },
        { value: 'custom', label: 'Custom Service' }
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

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.bridge"
      label="Network Bridge"
      type="text"
      placeholder="vmbr0 (management network)"
      icon=""
    />
    <FormField
      v-model="config.ipAddress"
      label="IP Address"
      type="text"
      placeholder="e.g., 10.0.0.10"
      icon=""
    />
  </FormSection>
</template>
