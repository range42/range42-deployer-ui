<script setup>
import { useRoute } from 'vue-router';
const route = useRoute();
</script>

<template>
  <section class="p-6">
    <h1 class="text-xl font-semibold">Preflight — deployment {{ route.params.id }}</h1>
    <p class="text-sm text-base-content/70 mt-1">Persisted preflight record (shareable URL). Plan C delivery.</p>
  </section>
</template>
