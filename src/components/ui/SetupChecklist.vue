<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProxmoxSettingsStore } from '@/stores/proxmoxSettingsStore'
import { useProjectStore } from '@/stores/projectStore'

const router = useRouter()
const { t } = useI18n()

const inv = useInventoryStore()
const pve = useProxmoxSettingsStore()
const proj = useProjectStore()

const steps = computed(() => [
  {
    id: 'source',
    title: t('home.checklist.add_source.title'),
    desc: t('home.checklist.add_source.desc'),
    href: '/sources',
    done: inv.sources.length > 0,
  },
  {
    id: 'proxmox',
    title: t('home.checklist.add_proxmox.title'),
    desc: t('home.checklist.add_proxmox.desc'),
    href: '/settings#proxmox-hosts',
    done: !!pve.settings?.baseUrl,
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
  if (href.startsWith('/')) router.push(href)
}
</script>

<template>
  <section class="max-w-2xl mx-auto p-6" data-testid="setup-checklist">
    <header class="mb-6 text-center">
      <h1 class="text-2xl font-bold">{{ t('home.welcome') }}</h1>
      <p class="text-sm text-base-content/70 mt-1">{{ t('home.welcome_sub') }}</p>
    </header>
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
