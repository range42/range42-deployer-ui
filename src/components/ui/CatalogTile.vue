<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { catalogCapabilities } from '@/services/catalogPresentation'

const props = defineProps({
  entry: { type: Object, required: true },
  projectId: { type: String, default: '' },
  nodeId: { type: String, default: '' },
  sourceReadonly: { type: Boolean, default: false },
  sourceName: { type: String, default: '' },
  sourceAvailable: { type: Boolean, default: true },
  browseQuery: { type: Object, default: () => ({}) },
})

defineEmits(['use', 'customize', 'fork', 'append'])

const { t } = useI18n()
const capabilities = computed(() => catalogCapabilities(props.entry.kind))
const detailLink = computed(() => ({ name: 'catalog-entry', params: { source: props.entry.source_id, entry: props.entry.path }, query: {
  ...props.browseQuery, ...(props.projectId ? { project: props.projectId, ...(props.nodeId ? { node: props.nodeId } : {}) } : {}),
} }))

const kindBadgeClass = computed(() => {
  switch (props.entry?.kind) {
    case 'lab':
      return 'badge-primary'
    case 'gamenet':
      return 'badge-secondary'
    case 'component':
      return 'badge-accent'
    case 'container':
      return 'badge-info'
    case 'ansible_role':
      return 'badge-warning'
    default:
      return 'badge-ghost'
  }
})

// Render `ansible_role` as a readable label without changing the underlying value.
const kindLabel = computed(() => t(`catalog.kinds.${capabilities.value.append ? props.entry.kind : 'unknown'}`))
</script>

<template>
  <article
    class="card border border-base-300 rounded-2xl bg-base-100 h-full hover:border-primary/50 transition-colors motion-reduce:transition-none"
    :data-kind="entry.kind"
    :data-source="entry.source_id"
  >
    <div class="card-body gap-0 p-5">
      <div class="mb-4 flex flex-wrap gap-2 items-center">
        <span class="badge badge-sm shrink-0" :class="kindBadgeClass">{{ kindLabel }}</span>
        <span v-if="entry.os" class="text-xs text-base-content/70">{{ entry.os }}</span>
        <span v-if="entry.difficulty" class="text-xs text-base-content/70">{{ entry.difficulty }}</span>
      </div>
      <header class="min-w-0">
        <div class="min-w-0">
          <h3 class="font-semibold text-lg break-words"><RouterLink class="link link-hover rounded focus-visible:outline focus-visible:outline-2" :to="detailLink">{{ entry.name }}</RouterLink></h3>
          <p class="text-xs text-base-content/60 truncate">
            {{ sourceName || entry.source_id }}
          </p>
          <span v-if="sourceReadonly" class="badge badge-ghost badge-sm mt-2" data-testid="tile-readonly-badge" :title="t('catalog.verbs.customize_readonly_hint')">{{ t('sources.access_readonly') }}</span>
        </div>
      </header>

      <p v-if="entry.description" class="text-sm text-base-content/70 line-clamp-3 mt-2">
        {{ entry.description }}
      </p>

      <div v-if="entry.tags?.length" class="flex flex-wrap gap-1 mt-3">
        <span
          v-for="tag in entry.tags.slice(0, 4)"
          :key="tag"
          class="badge badge-ghost badge-sm"
        >
          {{ tag }}
        </span>
      </div>

      <p class="text-xs text-base-content/70 mt-4 leading-relaxed">{{ t(`catalog.card_hints.${entry.kind === 'container' ? 'container' : entry.kind === 'ansible_role' ? 'role' : capabilities.create ? 'topology' : 'unsupported'}`) }}</p>
      <footer class="card-actions mt-auto pt-5 gap-2">
        <button v-if="capabilities.append" type="button" class="btn btn-sm flex-1" :class="projectId || !capabilities.create ? 'btn-primary' : 'btn-outline'" data-testid="catalog-add-to-project" :disabled="!sourceAvailable" @click="$emit('append', entry)">{{ t('catalog.append.action') }}</button>
        <button
          v-if="capabilities.create"
          type="button"
          class="btn btn-sm flex-1"
          :class="projectId ? 'btn-ghost' : 'btn-primary'"
          :disabled="!sourceAvailable"
          @click="$emit('use', entry)"
        >
          {{ t('catalog.verbs.use') }}
        </button>
        <details v-if="capabilities.create" class="dropdown dropdown-end">
          <summary class="btn btn-ghost btn-sm" :aria-label="t('catalog.more_for', { name: entry.name })">{{ t('catalog.more_actions') }}</summary>
          <ul class="dropdown-content menu z-10 mt-2 w-52 rounded-xl border border-base-300 bg-base-100 p-2 shadow-lg">
            <li><button type="button" :disabled="!sourceAvailable" @click="$emit('customize', entry)">{{ t('catalog.verbs.customize') }}</button></li>
            <li><button type="button" :disabled="!sourceAvailable" @click="$emit('fork', entry)">{{ t('catalog.verbs.fork') }}</button></li>
          </ul>
        </details>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
