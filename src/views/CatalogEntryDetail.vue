<script setup>
import { useRoute } from 'vue-router';
const route = useRoute();
</script>

<template>
  <section class="p-6">
    <h1 class="text-xl font-semibold">Catalog entry</h1>
    <p class="text-sm text-base-content/70 mt-1">source={{ route.params.source }} entry={{ route.params.entry }}</p>
    <p class="text-sm mt-4">Plan C delivery — README + preview + Use / Customize / Fork verbs.</p>
  </section>
</template>
