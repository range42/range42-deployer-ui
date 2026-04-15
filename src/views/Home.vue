<script setup>
import { computed, onMounted } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProxmoxSettingsStore } from '@/stores/proxmoxSettingsStore'
import { useProjectStore } from '@/stores/projectStore'
import Dashboard from '@/views/Dashboard.vue'
import SetupChecklist from '@/components/ui/SetupChecklist.vue'
import { ensureNamespaces } from '@/i18n'

const inv = useInventoryStore()
const pve = useProxmoxSettingsStore()
const proj = useProjectStore()

const firstRun = computed(
  () =>
    inv.sources.length === 0 &&
    !pve.settings?.baseUrl &&
    proj.projects.length === 0,
)

onMounted(async () => {
  await ensureNamespaces(['common', 'home', 'sources'])
  proj.loadProjects?.()
})
</script>

<template>
  <SetupChecklist v-if="firstRun" />
  <Dashboard v-else />
</template>
