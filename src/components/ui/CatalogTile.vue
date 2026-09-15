<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const props = defineProps({
  entry: { type: Object, required: true },
  projectId: { type: String, default: '' },
  nodeId: { type: String, default: '' },
  sourceReadonly: { type: Boolean, default: false },
})

defineEmits(['use', 'customize', 'fork', 'append'])

const { t } = useI18n()

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
const kindLabel = computed(() => String(props.entry?.kind ?? '').replace(/_/g, ' '))
</script>

<template>
  <article
    class="card card-bordered bg-base-100 hover:shadow-md transition-shadow h-full"
    :data-kind="entry.kind"
    :data-source="entry.source_id"
  >
    <div class="card-body p-5">
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="font-semibold text-lg break-words"><RouterLink class="link link-hover rounded focus-visible:outline focus-visible:outline-2" :to="{ name: 'catalog-entry', params: { source: entry.source_id, entry: entry.path }, query: projectId ? { project: projectId, ...(nodeId ? { node: nodeId } : {}) } : {} }">{{ entry.name }}</RouterLink></h3>
          <p class="text-xs text-base-content/60 truncate">
            {{ entry.source_id }} · {{ entry.path }}
          </p>
          <span v-if="sourceReadonly" class="badge badge-ghost badge-sm mt-2" data-testid="tile-readonly-badge" :title="t('catalog.verbs.customize_readonly_hint')">{{ t('sources.access_readonly') }}</span>
        </div>
        <span class="badge shrink-0" :class="kindBadgeClass">{{ kindLabel }}</span>
      </header>

      <p v-if="entry.description" class="text-sm text-base-content/70 line-clamp-3 mt-2">
        {{ entry.description }}
      </p>

      <div v-if="entry.tags?.length" class="flex flex-wrap gap-1 mt-3">
        <span
          v-for="tag in entry.tags"
          :key="tag"
          class="badge badge-ghost badge-sm"
        >
          {{ tag }}
        </span>
      </div>

      <p v-if="entry.kind === 'ansible_role' || entry.kind === 'container'" class="text-xs text-base-content/60 mt-2">{{ t('catalog.append.vm_required') }}</p>
      <footer class="card-actions mt-auto pt-4">
        <button type="button" class="btn btn-sm flex-1" :class="projectId ? 'btn-primary' : 'btn-outline'" data-testid="catalog-add-to-project" @click="$emit('append', entry)">{{ t('catalog.append.action') }}</button>
        <button
          type="button"
          class="btn btn-sm flex-1"
          :class="projectId ? 'btn-ghost' : 'btn-primary'"
          @click="$emit('use', entry)"
        >
          {{ t('catalog.verbs.use') }}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          @click="$emit('customize', entry)"
        >
          {{ t('catalog.verbs.customize') }}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          @click="$emit('fork', entry)"
        >
          {{ t('catalog.verbs.fork') }}
        </button>
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
