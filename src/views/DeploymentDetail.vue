<script setup>
import { useRoute } from 'vue-router';
const route = useRoute();
</script>

<template>
  <section class="p-6">
    <h1 class="text-xl font-semibold">Deployment {{ route.params.id }}</h1>
    <p class="text-sm text-base-content/70 mt-1">Overview · Teams · Logs — Plan C delivery.</p>
  </section>
</template>
