<script setup lang="ts">
import { useId } from 'vue'
const heading = useId()
</script>

<template>
  <section :aria-labelledby="heading" class="my-4 space-y-4 rounded-xl border border-base-300 p-4" data-testid="foundation-template-preview">
    <h2 :id="heading" class="font-semibold">How template preparation is deployed</h2>
    <ol class="grid gap-3 md:grid-cols-3">
      <li class="rounded-lg bg-base-200 p-4"><p class="font-medium">1. Original templates</p><p class="mt-2 text-sm">The recipe’s reviewed source templates remain unchanged on their source node.</p></li>
      <li class="rounded-lg bg-base-200 p-4"><p class="font-medium">2. Reusable copies</p><p class="mt-2 text-sm">A foundation deployment owns its reviewed stopped copies on the selected target. Inherited network and login data is removed.</p></li>
      <li class="rounded-lg bg-base-200 p-4"><p class="font-medium">3. Independent deployments</p><p class="mt-2 text-sm">Each deployment clones the selected copies and reserves its own resources.</p></li>
    </ol>
    <p class="text-sm">Choose the registered environment in Deploy to review its template set, exact VMIDs, hardware capacity and storage.</p>
    <p class="text-sm">The optional node preparation module must be enrolled. In Deploy, you can also include the registered environment’s isolated bridges through its separate optional network module. Gateways have separate deployment ownership.</p>
  </section>
</template>
