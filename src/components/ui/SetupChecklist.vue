<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSetupStatus } from '@/composables/useSetupStatus'
import { useProjectStore } from '@/stores/projectStore'

const emit = defineEmits(['navigate'])

const router = useRouter()
const { t } = useI18n()

const { hasSource, hasBackendHost } = useSetupStatus()
const proj = useProjectStore()

const steps = computed(() => [
  {
    id: 'backend',
    title: t('home.checklist.add_backend.title'),
    desc: t('home.checklist.add_backend.desc'),
    href: '/settings#backend-api',
    done: hasBackendHost.value,
  },
  {
    id: 'source',
    title: t('home.checklist.add_source.title'),
    desc: t('home.checklist.add_source.desc'),
    href: '/sources',
    done: hasSource.value,
  },
  {
    id: 'catalog',
    title: t('home.checklist.browse_catalog.title'),
    desc: t('home.checklist.browse_catalog.desc'),
    href: '/catalog',
    done: proj.projects.length > 0,
  },
])

function go(href) {
  emit('navigate')
  if (href.startsWith('/')) router.push(href)
}
</script>

<template>
  <section class="max-w-2xl mx-auto" data-testid="setup-checklist">
    <ol class="space-y-3">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="flex items-start gap-3 p-4 rounded-xl border border-base-300 bg-base-100"
      >
        <span
          class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold"
          :class="step.done ? 'bg-success text-success-content' : 'bg-base-200'"
          :aria-label="step.done ? t('home.checklist.done') : t('home.checklist.pending')"
        >
          <span v-if="step.done" aria-hidden="true">✓</span>
          <span v-else aria-hidden="true">{{ index + 1 }}</span>
        </span>
        <div class="flex-1">
          <div class="font-medium">{{ step.title }}</div>
          <p class="text-sm text-base-content/70">{{ step.desc }}</p>
        </div>
        <button
          v-if="!step.done"
          type="button"
          class="btn btn-primary btn-sm"
          @click="go(step.href)"
        >
          {{ t('home.checklist.go') }}
        </button>
        <span v-else class="badge badge-success">{{ t('home.checklist.done') }}</span>
      </li>
    </ol>
  </section>
</template>
