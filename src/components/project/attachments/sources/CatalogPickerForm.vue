<script setup>
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCatalog } from '@/composables/useCatalog'

const props = defineProps({
  source: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['update:source'])

const { t } = useI18n()

const catalog = useCatalog()

// Start loading immediately so the loading state is visible before onMounted fires.
catalog.loading.value = true

const mappedKind = computed(() =>
  props.source.kind === 'catalog_container' ? 'container' : 'ansible_role',
)

onMounted(async () => {
  await catalog.listEntries({ kind: mappedKind.value, limit: 200 })
})

function pickEntry(entry) {
  emit('update:source', {
    ...props.source,
    ref: `${entry.source_id}:${entry.path}`,
    sha: entry.sha,
  })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-if="catalog.loading.value && catalog.entries.value.length === 0"
      data-testid="catalog-pick-loading"
      class="flex items-center gap-2 py-4 text-sm opacity-60"
    >
      <span class="loading loading-spinner loading-sm" />
      {{ t('project.attachments.catalog.loading') }}
    </div>

    <div
      v-else-if="!catalog.loading.value && catalog.entries.value.length === 0"
      data-testid="catalog-pick-empty"
      class="py-4 text-sm opacity-60"
    >
      {{ t('project.attachments.catalog.empty') }}
    </div>

    <ul
      v-else
      class="flex flex-col gap-1"
    >
      <li
        v-for="entry in catalog.entries.value"
        :key="`${entry.source_id}:${entry.path}`"
        :data-testid="`catalog-pick-${entry.source_id}:${entry.path}`"
        class="flex flex-col gap-0.5 cursor-pointer rounded px-3 py-2
               border border-transparent hover:border-base-300"
        :class="{
          'bg-primary/10 ring ring-primary/30 ring-1': `${entry.source_id}:${entry.path}` === source.ref,
          'ring': `${entry.source_id}:${entry.path}` === source.ref,
        }"
        @click="pickEntry(entry)"
      >
        <span class="font-medium text-sm">{{ entry.name }}</span>
        <span class="font-mono text-xs opacity-60">{{ entry.source_id }}</span>
        <span class="font-mono text-xs opacity-50">{{ entry.path }}</span>
      </li>
    </ul>
  </div>
</template>
