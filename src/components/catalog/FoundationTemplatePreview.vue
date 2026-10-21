<script setup lang="ts">
import { useId } from 'vue'
const heading = useId()
</script>

<template>
  <section :aria-labelledby="heading" class="my-4 space-y-4 rounded-xl border border-base-300 p-4" data-testid="foundation-template-preview">
    <h2 :id="heading" class="font-semibold">How template preparation is deployed</h2>
    <ol class="grid gap-3 md:grid-cols-3">
      <li class="rounded-lg bg-base-200 p-4"><p class="font-medium">1. Original templates</p><p class="mt-2 text-sm">Reviewed nested Proxmox and Linux templates remain unchanged on their source node.</p></li>
      <li class="rounded-lg bg-base-200 p-4"><p class="font-medium">2. Reusable copies</p><p class="mt-2 text-sm">A foundation deployment owns two stopped copies on the selected target. Inherited network and login data is removed.</p></li>
      <li class="rounded-lg bg-base-200 p-4"><p class="font-medium">3. Independent workshop runs</p><p class="mt-2 text-sm">Each run clones the prepared copies and reserves its own participant environments and gateway.</p></li>
    </ol>
    <p class="text-sm">20 GiB configured RAM · 6 vCPUs · 192 GiB disks plus cloud-init. Choose the registered environment in Deploy to review its exact VMIDs and storage.</p>
    <p class="text-sm">The optional node preparation module must be enrolled. Bridge and gateway qualification are separate steps.</p>
  </section>
</template>
