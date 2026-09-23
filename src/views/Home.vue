<script setup>
defineOptions({ name: 'HomeView' })

import { ref, onMounted } from 'vue'
import { useProjectStore } from '@/stores/projectStore'
import Dashboard from '@/views/Dashboard.vue'
import SetupBanner from '@/components/ui/SetupBanner.vue'
import SetupWizardModal from '@/components/ui/SetupWizardModal.vue'
import { ensureNamespaces } from '@/i18n'

const proj = useProjectStore()
const wizardOpen = ref(false)

onMounted(async () => {
  await ensureNamespaces(['common', 'home', 'sources'])
  proj.loadProjects?.()
})
</script>

<template>
  <!-- Dashboard ALWAYS renders. Onboarding is a non-blocking banner that can
       open the guided steps in a modal — it never replaces the page. -->
  <div>
    <SetupBanner @open="wizardOpen = true" />
    <Dashboard />
    <SetupWizardModal :visible="wizardOpen" @close="wizardOpen = false" />
  </div>
</template>
