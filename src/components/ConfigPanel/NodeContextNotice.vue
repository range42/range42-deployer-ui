<script setup>
import { useI18n } from 'vue-i18n'
defineProps({ type: { type: String, required: true } })
const { t } = useI18n()
const notices = {
  "group": "alert-info",
  "simulated-internet": "alert-warning",
  "edge-firewall": "alert-success",
  "vuln-target": "alert-error",
  "shared-service": "alert-info"
}
</script>

<template>
  <div v-if="notices[type]" class="alert shadow-sm" :class="notices[type]" data-testid="node-context">
    <span>{{ t(`configPanel.context.${type}`) }}</span>
  </div>
</template>
