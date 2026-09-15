<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps<{ id?: string; collapsed?: boolean }>()
const emit = defineEmits<{ navigate: [] }>()
const route = useRoute()
const { t } = useI18n()
const groups = [
  { label: 'workspace', items: [
    { to: '/', key: 'projects', icon: 'folder-open', belongs: (path: string) => path === '/' || path.startsWith('/project/') },
    { to: '/catalog', key: 'catalog', icon: 'books', belongs: (path: string) => path === '/catalog' || path.startsWith('/catalog/') },
    { to: '/deployments', key: 'deployments', icon: 'rocket', belongs: (path: string) => path === '/deployments' || path.startsWith('/deployments/') },
  ] },
  { label: 'manage', items: [
    { to: '/sources', key: 'sources', icon: 'inbox', belongs: (path: string) => path === '/sources' },
    { to: '/settings', key: 'settings', icon: 'gear', belongs: (path: string) => path === '/settings' },
  ] },
]
</script>

<template>
  <nav :id="id" :aria-label="t('sidebar.navigation.primary')" class="app-navigation" :class="{ 'is-collapsed': collapsed }">
    <div v-for="group in groups" :key="group.label" class="navigation-group">
      <p class="navigation-group-label" :class="{ 'sr-only': collapsed }">{{ t(`sidebar.navigation.${group.label}`) }}</p>
      <ul class="space-y-1">
        <li v-for="item in group.items" :key="item.key">
          <RouterLink :to="item.to" custom v-slot="{ href, navigate }">
          <a :href="href" class="navigation-link" :class="{ 'is-active': item.belongs(route.path) }"
            :aria-current="item.belongs(route.path) ? (route.path === item.to ? 'page' : 'location') : undefined"
            :aria-label="t(`sidebar.navigation.${item.key}`)" :title="collapsed ? t(`sidebar.navigation.${item.key}`) : undefined" @click="navigate($event); emit('navigate')">
            <span class="shrink-0" aria-hidden="true"><AppIcon :name="item.icon" class="size-5" /></span>
            <span :class="{ 'sr-only': collapsed }">{{ t(`sidebar.navigation.${item.key}`) }}</span>
          </a>
          </RouterLink>
        </li>
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.app-navigation { display: flex; flex-direction: column; gap: 1.75rem; padding: 1.25rem .75rem; }
.navigation-group-label { padding: 0 .75rem; margin-bottom: .6rem; font-size: .6875rem; font-weight: 650; letter-spacing: .09em; text-transform: uppercase; color: color-mix(in oklab, var(--color-base-content) 70%, transparent); }
.navigation-link { display: flex; align-items: center; gap: .75rem; min-height: 2.875rem; padding: .6rem .75rem; border: 1px solid transparent; border-radius: .65rem; font-size: .875rem; font-weight: 550; color: color-mix(in oklab, var(--color-base-content) 80%, transparent); transition: background-color 150ms, color 150ms, border-color 150ms; }
.navigation-link:hover { background: var(--color-base-300); color: var(--color-base-content); }
.navigation-link.is-active { color: var(--color-base-content); background: var(--color-base-100); border-color: var(--color-base-300); box-shadow: inset 3px 0 var(--color-primary), 0 1px 2px rgb(0 0 0 / .04); }
.is-collapsed .navigation-link { justify-content: center; padding-inline: .5rem; }
</style>
