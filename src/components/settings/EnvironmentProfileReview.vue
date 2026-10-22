<script lang="ts">
export type ReviewedEnvironmentProfile = {
  vmid_ranges: [number, number][]
  proxmox_template: number
  deployer_template: number
  storage: string
  managed_gateway?: {management_bridge: string; management_subnet: string} | null
  networks: {bridge: string; subnet: string; gateway: string}[]
}
</script>

<script setup lang="ts">
import type {ResourceProfile} from '@/services/provisioning'
defineProps<{profile: ReviewedEnvironmentProfile | ResourceProfile}>()
</script>

<template>
  <div class="space-y-3">
    <dl class="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt class="font-medium">Guest VM IDs</dt><dd>{{ profile.vmid_ranges.map(([first,last]) => `${first}–${last}`).join(', ') }}</dd></div>
      <div><dt class="font-medium">Target storage</dt><dd>{{ profile.storage }}</dd></div>
      <div><dt class="font-medium">Source templates</dt><dd><template v-if="'templates' in profile">{{ Object.entries(profile.templates).map(([role,row])=>`${role} ${row.vm_id} (${row.memory_mib} MiB, ${row.cores} vCPUs)`).join(' · ') }}</template><template v-else>Proxmox template {{ profile.proxmox_template }} · Deployer template {{ profile.deployer_template }}</template></dd></div>
      <div><dt class="font-medium">Isolated networks</dt><dd>{{ profile.networks.length }} separate /28 networks</dd></div>
      <div v-if="profile.managed_gateway"><dt class="font-medium">One gateway per run</dt><dd>{{ profile.managed_gateway.management_bridge }} · {{ profile.managed_gateway.management_subnet }}</dd></div>
    </dl>
    <div class="max-h-64 overflow-auto rounded border border-base-300 focus-visible:outline-2 focus-visible:outline-primary" tabindex="0" role="region" aria-label="Reviewed network allocations">
      <table class="table table-sm w-full" data-testid="environment-reviewed-networks">
        <caption class="p-2 text-left text-sm font-medium">Exact reviewed networks</caption>
        <thead class="sticky top-0 z-10 bg-base-200"><tr><th scope="col">Bridge</th><th scope="col">Subnet</th><th scope="col">Gateway</th></tr></thead>
        <tbody><tr v-for="network in profile.networks" :key="network.bridge"><th scope="row">{{ network.bridge }}</th><td>{{ network.subnet }}</td><td>{{ network.gateway }}</td></tr></tbody>
      </table>
    </div>
  </div>
</template>
