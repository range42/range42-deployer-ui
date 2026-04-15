<script setup>
import { useRoute, useRouter } from 'vue-router';
import { computed } from 'vue';
import { useHotkeys } from '@/composables/useHotkeys';

const route = useRoute();
const router = useRouter();

// Rail shortcuts per spec §5. `n` routes to the Projects dashboard where the
// user clicks "New project" — creating a draft requires picking a source +
// strategy and therefore can't be a fire-and-forget hotkey.
useHotkeys([
  { key: 'v', handler: () => router.push('/catalog') },
  { key: 'c', handler: () => router.push('/catalog') },
  { key: 'n', handler: () => router.push('/') },
  { key: 'r', handler: () => router.push('/deployments') },
  { key: 'f', handler: () => router.push('/sources') },
  { key: 'g', handler: () => router.push('/settings') },
]);

// Auto-collapse rail on /project/:id and /deployments/:id (spec §5)
const collapsed = computed(() => {
  const p = route.path;
  return p.startsWith('/project/') || /^\/deployments\/[^/]+/.test(p);
});

const railWidth = computed(() => (collapsed.value ? '40px' : '56px'));

// Rail items per spec §5: Catalog · Projects · Deployments · Sources · Settings.
// "Projects" routes to / (the Dashboard that lists projects + active deployments).
const navItems = [
  { to: '/catalog', key: 'catalog', label: 'Catalog' },
  { to: '/', key: 'projects', label: 'Projects' },
  { to: '/deployments', key: 'deployments', label: 'Deployments' },
  { to: '/sources', key: 'sources', label: 'Sources' },
  { to: '/settings', key: 'settings', label: 'Settings' },
];
</script>

<template>
  <div class="app-shell flex h-screen w-screen">
    <nav
      class="rail bg-base-200 flex flex-col items-center py-2 gap-1 border-r border-base-300"
      :style="{ width: railWidth }"
      aria-label="Primary"
    >
      <router-link
        v-for="item in navItems"
        :key="item.key"
        :to="item.to"
        class="rail-btn w-full text-center text-xs py-2 hover:bg-base-300"
        :aria-label="item.label"
        :title="item.label"
      >
        {{ item.label.charAt(0) }}
      </router-link>
    </nav>

    <div class="flex-1 flex flex-col min-w-0">
      <div class="breadcrumb-strip h-6 px-3 text-xs text-base-content/70 border-b border-base-300 flex items-center">
        <span>{{ route.meta?.title ?? 'Range42' }}</span>
      </div>
      <main class="flex-1 overflow-auto min-w-0">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.rail {
  transition: width 150ms ease;
}
</style>
