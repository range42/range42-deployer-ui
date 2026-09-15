<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { useUiPreferencesStore } from '@/stores/uiPreferencesStore'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUserStore, validateDisplayName, validateColor } from '@/stores/userStore'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import BackendConnectionsPanel from '@/components/settings/BackendConnectionsPanel.vue'
import RegisteredTargetsPanel from '@/components/settings/RegisteredTargetsPanel.vue'
import RetentionPreferencesPanel from '@/components/settings/RetentionPreferencesPanel.vue'
import EditorPreferencesPanel from '@/components/settings/EditorPreferencesPanel.vue'

defineOptions({ name: 'SettingsView' })
const route = useRoute()
const appearance = useUiPreferencesStore()
const backend = useBackendApiStore()
const projects = useProjectStore()
const user = useUserStore()
const { confirm } = useConfirmDialog()
const sections = [
  { id: 'connections', label: 'Connections', description: 'Backend access and Proxmox targets' },
  { id: 'preferences', label: 'Preferences', description: 'Appearance and editor behaviour' },
  { id: 'identity', label: 'Identity', description: 'Your name in collaborative projects' },
  { id: 'snapshots', label: 'Snapshots', description: 'Retention review preferences' },
  { id: 'data', label: 'Local data', description: 'Projects stored in this browser' },
]
function sectionFor(location) {
  if (sections.some(section => section.id === location.query.tab)) return location.query.tab
  return location.hash === '#user-identity' ? 'identity' : location.hash === '#snapshot-retention' ? 'snapshots' : 'connections'
}
const active = computed(() => sectionFor(route))
const activeSection = computed(() => sections.find(section => section.id === active.value))
const panelDirty = ref(false)
const identityForm = ref({ display_name: user.display_name, color: user.color })
const nameError = ref(''), colorError = ref(''), identityStatus = ref('')
const nameInput = ref(null), colorInput = ref(null), dataError = ref(''), dataStatus = ref('')
const identityDirty = computed(() => identityForm.value.display_name !== user.display_name || identityForm.value.color !== user.color)
const dirty = computed(() => panelDirty.value || (active.value === 'identity' && identityDirty.value))
async function allowNavigation() {
  return !dirty.value || await confirm({ title: 'Discard unsaved settings?', message: 'Your unsaved changes in this section will be lost.', confirmText: 'Discard changes' })
}
onBeforeRouteLeave(allowNavigation)
onBeforeRouteUpdate((to, from) => sectionFor(to) === sectionFor(from) || allowNavigation())
watch(active, () => {
  panelDirty.value = false
  identityForm.value = { display_name: user.display_name, color: user.color }
  nameError.value = ''; colorError.value = ''; identityStatus.value = ''
})
function beforeUnload(event) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { projects.loadProjects(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
async function saveIdentity() {
  nameError.value = validateDisplayName(identityForm.value.display_name) || ''
  colorError.value = validateColor(identityForm.value.color) || ''
  if (nameError.value || colorError.value) {
    await nextTick(); (nameError.value ? nameInput : colorInput).value?.focus(); return
  }
  user.setDisplayName(identityForm.value.display_name)
  user.setColor(identityForm.value.color)
  identityForm.value = { display_name: user.display_name, color: user.color }
  identityStatus.value = user.storageError ? '' : 'Identity saved in this browser.'
}
function retryIdentity() {
  if (user.retryPersistence()) identityStatus.value = 'Identity saved in this browser.'
}
async function clearProjectList() {
  dataError.value = ''; dataStatus.value = ''
  if (!await confirm({ title: 'Clear the local project list?', message: `Remove ${projects.projects.length} projects from this browser’s list? Export unsaved work first. Git repositories, cached drafts, backend connections and running deployments are kept.`, confirmText: 'Clear project list', confirmClass: 'btn-error' })) return
  try {
    projects.clearAllData()
    dataStatus.value = 'Local project list cleared. Backend connections and repository data are kept.'
  } catch { dataError.value = 'Browser storage is unavailable. The project list was not cleared.' }
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8" data-testid="settings-page">
    <header class="flex flex-wrap items-start justify-between gap-4 mb-8">
      <div><h1 class="text-3xl font-semibold tracking-tight">Settings</h1><p class="mt-2 text-base-content/75">Connect your environment and make the workspace yours.</p></div>
      <router-link to="/sources" class="btn btn-outline btn-sm">Manage Git sources</router-link>
    </header>
    <div class="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="Settings sections" class="flex flex-wrap gap-1 content-start lg:flex-col">
        <router-link v-for="section in sections" :key="section.id" :to="{ path: '/settings', query: { tab: section.id } }"
          class="rounded-lg px-4 py-3 text-sm font-medium transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          :class="active === section.id ? 'bg-base-200 text-base-content border-l-2 border-primary' : 'text-base-content/80'"
          :aria-current="active === section.id ? 'page' : undefined" :data-testid="`settings-link-${section.id}`">{{ section.label }}</router-link>
      </nav>
      <div class="min-w-0 space-y-6">
        <p class="text-xs font-medium uppercase tracking-wide text-base-content/65">{{ activeSection.description }}<span v-if="dirty" class="ml-3 normal-case tracking-normal text-warning">Unsaved changes</span></p>
        <template v-if="active === 'connections'">
          <BackendConnectionsPanel @dirty="panelDirty = $event" />
          <RegisteredTargetsPanel :profile-id="backend.activeHost?.id || ''" />
          <section class="rounded-xl border border-base-300 p-5" aria-labelledby="sources-heading">
            <h2 id="sources-heading" class="font-semibold">Catalog and Git providers</h2>
            <p class="text-sm text-base-content/75 mt-2">Manage public and private repositories, source credentials and indexing in Sources. GitHub, GitLab and Gitea use the same source workflow.</p>
            <router-link to="/sources" class="link inline-block text-sm mt-3 underline-offset-4">Open Sources</router-link>
          </section>
        </template>
        <template v-else-if="active === 'preferences'">
          <section class="rounded-xl border border-base-300 p-5" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading" class="text-xl font-semibold">Appearance</h2>
            <p class="text-sm text-base-content/75 mt-2 mb-4">Choose a theme for this browser.</p>
            <label for="appearance-theme" class="block text-sm font-medium mb-2">Theme</label>
            <select id="appearance-theme" v-model="appearance.theme" name="theme" class="select w-full sm:max-w-xs"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
          </section>
          <EditorPreferencesPanel />
        </template>
        <section v-else-if="active === 'identity'" id="user-identity" class="space-y-5" data-testid="settings-user-identity" aria-labelledby="identity-heading">
          <div><h2 id="identity-heading" class="text-xl font-semibold">Collaborator identity</h2><p class="mt-2 text-sm text-base-content/75">Your display name identifies your project edits and Git commits. Backend permissions come from your API token.</p></div>
          <form class="space-y-4" novalidate @submit.prevent="saveIdentity">
            <div>
              <label for="identity-name" class="block text-sm font-medium mb-1">Display name</label>
              <input id="identity-name" ref="nameInput" v-model="identityForm.display_name" name="display-name" autocomplete="nickname" maxlength="64" class="input w-full" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'identity-name-error' : undefined" data-testid="user-display-name" />
              <p v-if="nameError" id="identity-name-error" role="alert" class="text-sm text-error mt-1">{{ nameError }}</p>
            </div>
            <div>
              <label for="identity-color" class="block text-sm font-medium mb-1">Collaborator colour</label>
              <div class="flex items-center gap-3">
                <input id="identity-color" v-model="identityForm.color" name="colour" type="color" class="h-11 w-14 rounded border border-base-300" data-testid="user-color" />
                <input ref="colorInput" v-model="identityForm.color" name="colour-code" autocomplete="off" aria-label="Colour hex code" spellcheck="false" class="input flex-1 min-w-0 font-mono" :aria-invalid="!!colorError" :aria-describedby="colorError ? 'identity-color-error' : undefined" />
              </div>
              <p v-if="colorError" id="identity-color-error" role="alert" class="text-sm text-error mt-1">{{ colorError }}</p>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Save identity</button><p role="status" class="text-sm">{{ identityStatus }}</p>
          </form>
          <div v-if="user.storageError" class="rounded-lg border border-warning/40 p-3 space-y-2">
            <p role="alert" class="text-sm" data-testid="identity-storage-error">{{ user.storageError }}</p>
            <button type="button" class="btn btn-outline btn-sm" data-testid="retry-identity-storage" @click="retryIdentity">Retry saving identity</button>
          </div>
        </section>
        <RetentionPreferencesPanel v-else-if="active === 'snapshots'" @dirty="panelDirty = $event" />
        <section v-else-if="active === 'data'" class="space-y-5" aria-labelledby="data-heading">
          <div><h2 id="data-heading" class="text-xl font-semibold">Local project data</h2><p class="mt-2 text-sm text-base-content/75">This browser has {{ projects.projects.length }} projects in its list. Export unsaved work from Projects before removing it.</p></div>
          <router-link to="/" class="btn btn-outline btn-sm">Open Projects</router-link>
          <div class="rounded-xl border border-error/25 p-5 space-y-3">
            <h3 class="font-semibold">Clear the local project list</h3>
            <p class="text-sm text-base-content/75">Removes the project list in this browser. Git repositories, cached drafts, saved connections and running deployments remain available. Reopen a saved project from Git to add it back.</p>
            <button type="button" class="btn btn-error btn-outline btn-sm" :disabled="!projects.projects.length" data-testid="clear-local-projects" @click="clearProjectList">Clear local project list</button>
          </div>
          <p v-if="dataError" role="alert" class="text-sm text-error">{{ dataError }}</p><p role="status" class="text-sm">{{ dataStatus }}</p>
        </section>
      </div>
    </div>
  </div>
</template>
