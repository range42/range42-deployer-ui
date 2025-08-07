<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isProjectEditor = computed(() => route.name === 'project-editor')
</script>

<template>
  <div class="h-screen bg-base-100">
    <!-- Main Router View -->
    <RouterView />
  </div>
</template>

<style>
@import 'https://cdn.jsdelivr.net/npm/@vue-flow/core@1.45.0/dist/style.css';
@import 'https://cdn.jsdelivr.net/npm/@vue-flow/core@1.45.0/dist/theme-default.css';
@import 'https://cdn.jsdelivr.net/npm/@vue-flow/controls@latest/dist/style.css';
@import 'https://cdn.jsdelivr.net/npm/@vue-flow/minimap@latest/dist/style.css';

/* Ensure router view takes full height */
#app {
  height: 100vh;
}
</style>
