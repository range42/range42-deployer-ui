<script setup lang="ts">
export interface GatewayFoundation {
  vmid: number; node: string; name: string; vmgenid: string; owner: string; configuration_revision: string;
  nics: Array<{interface: string; bridge: string; mac: string}>;
}
export interface GatewayNicCapacity {
  limit: number; occupied: number; additional_required: number; available: number; remaining_after_preparation: number;
}
defineProps<{foundation: GatewayFoundation; capacity?: GatewayNicCapacity | null}>()
</script>

<template>
  <div class="space-y-3 rounded border border-base-300 p-3" data-testid="gateway-foundation-review">
    <p class="font-medium">Retained gateway {{ foundation.vmid }} · {{ foundation.name }} · {{ foundation.node }}</p>
    <p v-if="capacity" class="text-sm">{{ capacity.limit }} NIC slots maximum · {{ capacity.occupied }} in use · {{ capacity.additional_required }} additional ports needed · {{ capacity.remaining_after_preparation }} remain after preparation.</p>
    <p class="text-sm">Owner: <code class="break-all">{{ foundation.owner }}</code></p>
    <details><summary class="cursor-pointer text-sm">Recorded gateway identity</summary><p class="mt-2 text-xs">Original VM generation: <code class="break-all">{{ foundation.vmgenid }}</code></p><p class="mt-1 text-xs">Configuration revision: <code class="break-all">{{ foundation.configuration_revision }}</code></p></details>
    <div class="max-h-64 overflow-auto rounded border border-base-300 focus-visible:outline focus-visible:outline-primary" tabindex="0" role="region" aria-label="Recorded gateway ports">
      <table class="table table-xs"><caption class="px-2 py-2 text-left text-sm font-medium">Recorded gateway ports</caption>
        <thead class="sticky top-0 bg-base-100"><tr><th scope="col">Interface</th><th scope="col">Bridge</th><th scope="col">MAC address</th></tr></thead>
        <tbody><tr v-for="nic in foundation.nics" :key="nic.interface"><th scope="row">{{ nic.interface }}</th><td>{{ nic.bridge }}</td><td><code>{{ nic.mac }}</code></td></tr></tbody>
      </table>
    </div>
    <p class="text-xs">This records the existing gateway and the space for future ports. Infrastructure preparation and qualification are still required.</p>
  </div>
</template>
