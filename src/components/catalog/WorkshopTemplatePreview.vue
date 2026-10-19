<script setup lang="ts">
defineProps<{ minSeats: number; maxSeats: number }>()
</script>

<template>
  <section class="my-4 rounded-xl border border-base-300 p-4 space-y-4" data-testid="workshop-template-preview" aria-labelledby="workshop-template-layout">
    <div><h2 id="workshop-template-layout" class="font-semibold">How this workshop is deployed</h2>
      <p class="mt-1 text-sm">{{ minSeats }}–{{ maxSeats }} participants · Two virtual machines and one isolated network per participant.</p></div>
    <div class="grid gap-3 sm:grid-cols-3" role="img" aria-label="Each participant connects from their laptop to their own Proxmox and deployer on an isolated network.">
      <div class="rounded-lg bg-base-200 p-4"><p class="font-medium">Your laptop</p><p class="mt-2 text-sm">Connect through the workshop's selected access method.</p></div>
      <div class="rounded-lg border border-primary/40 p-4"><p class="font-medium">Your Proxmox</p><p class="mt-2 text-sm">Private hypervisor for installing Range42 and deploying your practice lab.</p></div>
      <div class="rounded-lg border border-primary/40 p-4"><p class="font-medium">Your deployer</p><p class="mt-2 text-sm">Install the native CLI, then your own backend API and Deployer UI.</p></div>
    </div>
    <p class="text-sm text-base-content/70">Choose the participant count, target, templates and resource allocation in Deploy. Review the exact machines and networks before creating the run. Central identity and laptop connectivity are separate integrations; shared platform services are retained between runs.</p>
  </section>
</template>
