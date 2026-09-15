<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n'
import { useUiPreferencesStore } from '@/stores/uiPreferencesStore'
import AppNavigation from '@/components/AppNavigation.vue'
import SidebarDrawer from '@/components/ui/SidebarDrawer.vue'
import LegacyStorageBanner from '@/components/LegacyStorageBanner.vue'
import BackendAccessPanel from '@/components/ui/BackendAccessPanel.vue'

const route = useRoute()
const { t } = useI18n()
const preferences = useUiPreferencesStore()
const mobileOpen = ref(false)
onMounted(() => ensureNamespaces(['sidebar']))
watch(() => route.path, () => { mobileOpen.value = false })
watch(() => preferences.theme, theme => {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme
}, { immediate: true })

const section = computed(() => {
  if (route.path.startsWith('/catalog')) return { label: t('sidebar.navigation.catalog'), to: '/catalog' }
  if (route.path.startsWith('/deployments')) return { label: t('sidebar.navigation.deployments'), to: '/deployments' }
  if (route.path === '/sources') return { label: t('sidebar.navigation.sources'), to: '/sources' }
  if (route.path === '/settings') return { label: t('sidebar.navigation.settings'), to: '/settings' }
  return { label: t('sidebar.navigation.projects'), to: '/' }
})
const detail = computed(() => route.path !== section.value.to)
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">{{ t('sidebar.navigation.skip') }}</a>
    <aside class="primary-sidebar" :class="{ 'is-collapsed': preferences.collapsed }" data-testid="primary-sidebar">
      <div class="brand-lockup" :class="{ 'justify-center': preferences.collapsed }">
        <span class="brand-mark" aria-hidden="true">42</span>
        <div v-if="!preferences.collapsed" class="min-w-0"><p class="font-semibold tracking-tight" translate="no">Range42</p><p class="text-xs text-base-content/70">{{ t('sidebar.navigation.deployer') }}</p></div>
      </div>
      <AppNavigation id="desktop-navigation" :collapsed="preferences.collapsed" class="flex-1 overflow-y-auto" />
      <div class="border-t border-base-300 p-3">
        <button type="button" class="sidebar-toggle" :aria-label="t(`sidebar.navigation.${preferences.collapsed ? 'expand' : 'collapse'}`)"
          :title="t(`sidebar.navigation.${preferences.collapsed ? 'expand' : 'collapse'}`)" :aria-expanded="!preferences.collapsed" aria-controls="desktop-navigation"
          @click="preferences.collapsed = !preferences.collapsed">
          <svg class="size-5 shrink-0" :class="{ 'rotate-180': preferences.collapsed }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m7-12-4 4 4 4" /></svg>
          <span v-if="!preferences.collapsed">{{ t('sidebar.navigation.collapse') }}</span>
        </button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <LegacyStorageBanner />
      <header class="shell-header">
        <button type="button" class="btn btn-ghost btn-square h-11 min-h-11 md:hidden" :aria-label="t('sidebar.navigation.open')"
          :aria-expanded="mobileOpen" aria-controls="mobile-navigation" @click="mobileOpen = true">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <nav :aria-label="t('sidebar.navigation.breadcrumb')" class="min-w-0 text-sm">
          <ol class="flex min-w-0 items-center gap-2">
            <li v-if="detail"><RouterLink :to="section.to" class="rounded text-base-content/70 hover:text-base-content">{{ section.label }}</RouterLink></li>
            <li v-if="detail" aria-hidden="true" class="text-base-content/60">/</li>
            <li aria-current="page" class="truncate font-medium">{{ detail ? route.meta.title || t('sidebar.projectTools') : section.label }}</li>
          </ol>
        </nav>
      </header>
      <main id="main-content" tabindex="-1" class="min-h-0 min-w-0 flex-1 overflow-auto">
        <BackendAccessPanel />
        <router-view :key="route.name === 'project-editor' ? `project:${route.params.id}` : undefined" />
      </main>
    </div>
    <SidebarDrawer :open="mobileOpen" :title="t('sidebar.navigation.title')" :close-label="t('sidebar.navigation.close')" @close="mobileOpen = false">
      <div class="brand-lockup"><span class="brand-mark" aria-hidden="true">42</span><span class="font-semibold" translate="no">Range42</span></div>
      <AppNavigation id="mobile-navigation" @navigate="mobileOpen = false" />
    </SidebarDrawer>
  </div>
</template>

<style scoped>
.app-shell { display: flex; height: 100dvh; width: 100%; background: var(--color-base-100); color: var(--color-base-content); }
.primary-sidebar { display: flex; flex-direction: column; width: 13.5rem; flex-shrink: 0; background: var(--color-base-200); border-right: 1px solid var(--color-base-300); padding-bottom: env(safe-area-inset-bottom); }
.primary-sidebar.is-collapsed { width: 4.5rem; }
.brand-lockup { display: flex; align-items: center; gap: .75rem; min-height: 5rem; padding: 1.25rem; }
.brand-mark { display: grid; place-items: center; width: 2rem; height: 2rem; flex-shrink: 0; border-radius: .65rem; background: var(--color-base-content); color: var(--color-base-100); font-weight: 750; font-size: .875rem; letter-spacing: -.03em; }
.sidebar-toggle { display: flex; align-items: center; justify-content: center; gap: .75rem; width: 100%; min-height: 2.75rem; padding: .5rem; border-radius: .5rem; font-size: .75rem; color: color-mix(in oklab, var(--color-base-content) 80%, transparent); cursor: pointer; }
.sidebar-toggle:hover { background: var(--color-base-300); color: var(--color-base-content); }
.shell-header { display: flex; align-items: center; gap: .5rem; min-height: 3.5rem; flex-shrink: 0; padding: .375rem 1.25rem; padding-top: max(.375rem, env(safe-area-inset-top)); border-bottom: 1px solid var(--color-base-300); }
.skip-link { position: fixed; z-index: 2000; top: .75rem; left: .75rem; padding: .75rem 1rem; border-radius: .5rem; background: var(--color-base-content); color: var(--color-base-100); transform: translateY(-200%); }
.skip-link:focus { transform: translateY(0); }
@media (max-width: 767px) { .primary-sidebar { display: none; } .shell-header { padding-inline: .75rem; } }
</style>
