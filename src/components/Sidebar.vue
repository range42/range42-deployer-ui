<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces, setLocale } from '@/i18n'
import { SUPPORTED_LOCALES } from '@/i18n/supported'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import AppIcon from '@/components/icons/AppIcon.vue'

defineOptions({ name: 'ProjectSidebar' })
const props = defineProps<{ project?: { name?: string; nodes?: unknown[]; edges?: unknown[] } }>()
const emit = defineEmits<{
  addComponent: [type: string]; openExport: []; openDeploy: []; openValidate: [];
  openInventory: []; openTemplates: []; openImport: [];
}>()
const { t, locale } = useI18n()
const { onDragStart } = useDragAndDrop()
const id = useId()
const expanded = ref({ components: true, resources: true, status: false })
const counts = computed(() => ({ nodes: props.project?.nodes?.length || 0, edges: props.project?.edges?.length || 0 }))
onMounted(() => ensureNamespaces(['sidebar', 'common']))
function changeLocale(event: Event) {
  void setLocale((event.target as HTMLSelectElement).value, ['sidebar', 'common', 'project'])
}
const categories = [
  { key: 'compute', items: [{ type: 'vm', icon: 'monitor' }, { type: 'lxc', icon: 'cube' }, { type: 'docker', icon: 'container' }] },
  { key: 'network', items: [{ type: 'network-segment', icon: 'link' }, { type: 'router', icon: 'router' }, { type: 'edge-firewall', icon: 'shield' }] },
  { key: 'organization', items: [{ type: 'group', icon: 'folder-open' }, { type: 'note', icon: 'document' }] },
]
const resources = [
  { key: 'templates', icon: 'disc', action: () => emit('openTemplates') },
  { key: 'import', icon: 'inbox', action: () => emit('openImport') },
  { key: 'export', icon: 'outbox', action: () => emit('openExport') },
]
const statuses = ['gray', 'orange', 'green', 'red', 'blue']
</script>

<template>
  <aside class="project-sidebar" data-testid="project-sidebar" :aria-label="t('sidebar.projectTools')">
    <header class="border-b border-base-300 px-4 py-4">
      <p class="section-eyebrow mb-2">{{ t('sidebar.currentProject') }}</p>
      <h2 class="truncate text-sm font-semibold" :title="project?.name">{{ project?.name || t('sidebar.untitledProject') }}</h2>
      <p class="mt-1 text-xs text-base-content/70 tabular-nums">{{ t('sidebar.nodeCount', counts.nodes) }} · {{ t('sidebar.edgeCount', counts.edges) }}</p>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div class="p-3">
        <button type="button" class="catalog-action" @click="emit('openInventory')">
          <span aria-hidden="true"><AppIcon name="books" class="size-5 shrink-0" /></span>
          <span class="min-w-0"><span class="block text-sm font-semibold">{{ t('sidebar.catalog.title') }}</span><span class="mt-0.5 block text-xs text-base-content/70">{{ t('sidebar.catalog.description') }}</span></span>
          <span class="ml-auto text-lg" aria-hidden="true">+</span>
        </button>
      </div>
      <section class="border-b border-base-300">
        <h3><button type="button" class="section-toggle" :aria-expanded="expanded.components" :aria-controls="`${id}-components`" @click="expanded.components = !expanded.components">
          <span>{{ t('sidebar.components') }}</span><span aria-hidden="true">{{ expanded.components ? '−' : '+' }}</span>
        </button></h3>
        <div v-show="expanded.components" :id="`${id}-components`" class="px-3 pb-4">
          <p class="px-1 pb-3 text-xs text-base-content/70">{{ t('sidebar.addHint') }}</p>
          <div v-for="category in categories" :key="category.key" class="mb-4 last:mb-0">
            <h4 class="mb-1.5 px-1 text-xs font-medium text-base-content/70">{{ t(`sidebar.categories.${category.key}`) }}</h4>
            <div class="space-y-1">
              <button v-for="component in category.items" :key="component.type" type="button" class="palette-item" draggable="true"
                :aria-label="t(`sidebar.items.${component.type}.add`)" @dragstart="onDragStart($event, component.type)" @click="emit('addComponent', component.type)">
                <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-base-200"><span aria-hidden="true"><AppIcon :name="component.icon" class="size-5" /></span></span>
                <span class="min-w-0 flex-1"><span class="block text-sm font-medium">{{ t(`sidebar.items.${component.type}.label`) }}</span><span class="block text-xs text-base-content/70">{{ t(`sidebar.items.${component.type}.description`) }}</span></span>
                <span class="text-base-content/70" aria-hidden="true">+</span>
              </button>
            </div>
          </div>
        </div>
      </section>
      <section class="border-b border-base-300">
        <h3><button type="button" class="section-toggle" :aria-expanded="expanded.resources" :aria-controls="`${id}-resources`" @click="expanded.resources = !expanded.resources">
          <span>{{ t('sidebar.resources') }}</span><span aria-hidden="true">{{ expanded.resources ? '−' : '+' }}</span>
        </button></h3>
        <div v-show="expanded.resources" :id="`${id}-resources`" class="space-y-1 px-3 pb-3">
          <button v-for="resource in resources" :key="resource.key" type="button" class="palette-item" @click="resource.action">
            <span aria-hidden="true"><AppIcon :name="resource.icon" class="size-5 shrink-0" /></span>
            <span class="min-w-0"><span class="block text-sm font-medium">{{ t(`sidebar.resourcesItems.${resource.key}.title`) }}</span><span class="block text-xs text-base-content/70">{{ t(`sidebar.resourcesItems.${resource.key}.description`) }}</span></span>
          </button>
        </div>
      </section>
      <section>
        <h3><button type="button" class="section-toggle" :aria-expanded="expanded.status" :aria-controls="`${id}-status`" @click="expanded.status = !expanded.status">
          <span>{{ t('sidebar.statusTitle') }}</span><span aria-hidden="true">{{ expanded.status ? '−' : '+' }}</span>
        </button></h3>
        <ul v-show="expanded.status" :id="`${id}-status`" class="space-y-2 px-4 pb-4 text-xs">
          <li v-for="status in statuses" :key="status" class="flex items-center gap-2"><span class="status-dot" :class="status" aria-hidden="true" />{{ t(`sidebar.statuses.${status}`) }}</li>
        </ul>
      </section>
    </div>
    <footer class="shrink-0 space-y-3 border-t border-base-300 bg-base-100 p-3">
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-outline min-h-11 h-auto py-2" @click="emit('openValidate')">{{ t('sidebar.validate') }}</button>
        <button type="button" class="btn btn-primary min-h-11 h-auto py-2" @click="emit('openDeploy')">{{ t('sidebar.deploy') }}</button>
      </div>
      <select class="select select-sm w-full bg-base-100 text-base-content" :value="locale" :aria-label="t('sidebar.language.label')" @change="changeLocale">
        <option v-for="language in SUPPORTED_LOCALES" :key="language.code" :value="language.code">{{ language.label }}</option>
      </select>
    </footer>
  </aside>
</template>

<style scoped>
.project-sidebar { display: flex; flex-direction: column; width: 17rem; max-width: 100%; height: 100%; background: var(--color-base-100); border-right: 1px solid var(--color-base-300); }
.section-eyebrow { font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .08em; color: color-mix(in oklab, var(--color-base-content) 70%, transparent); }
.section-toggle { display: flex; justify-content: space-between; align-items: center; gap: 1rem; width: 100%; min-height: 2.75rem; padding: .75rem 1rem; font-size: .8125rem; font-weight: 650; text-align: left; cursor: pointer; }
.section-toggle:hover { background: var(--color-base-200); }
.palette-item { display: flex; align-items: center; gap: .65rem; width: 100%; min-height: 3rem; border: 1px solid transparent; border-radius: .5rem; padding: .5rem; text-align: left; cursor: pointer; transition: background-color 150ms, border-color 150ms; }
.palette-item:hover { background: var(--color-base-200); border-color: var(--color-base-300); }
.palette-item:active { background: var(--color-base-300); }
.catalog-action { display: flex; align-items: center; gap: .65rem; width: 100%; border: 1px solid var(--color-base-300); border-radius: .65rem; padding: .75rem; background: var(--color-base-200); text-align: left; cursor: pointer; }
.catalog-action:hover { border-color: var(--color-primary); }
</style>
