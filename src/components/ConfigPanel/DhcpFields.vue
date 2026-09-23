<script setup>
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <FormDivider label="DHCP Server Settings" icon="" />

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.scope"
      label="IP Range/Scope"
      type="text"
      :required="true"
      placeholder="e.g., 192.168.1.100-200"
      hint="Range of IPs to assign to clients"
      icon=""
    />
    <FormField
      v-model="config.leaseTime"
      label="Lease Time"
      type="text"
      placeholder="e.g., 24h, 7d"
      hint="How long clients can use assigned IPs"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.gateway"
      label="Default Gateway"
      type="text"
      :required="true"
      placeholder="e.g., 192.168.1.1"
      icon=""
    />
    <FormField
      v-model="config.dnsServers"
      label="DNS Servers"
      type="text"
      placeholder="e.g., 192.168.1.1, 8.8.8.8"
      hint="Comma-separated list of DNS servers"
      icon=""
    />
  </FormSection>
</template>
