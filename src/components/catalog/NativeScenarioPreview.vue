<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { selectNativeTopology, type NativeTopology, type NativeFeature } from '@/services/nativeScenarioCanvas'
const props = defineProps<{ topology: NativeTopology; features?: NativeFeature[]; selectedFeatures?: Record<string, boolean> }>()
const selection = ref<Record<string, boolean>>({})
watch(() => props.features, features => { selection.value = Object.fromEntries((features || []).map(feature => [feature.id, feature.default])) }, { immediate: true })
const effective = computed(() => selectNativeTopology(props.topology, props.selectedFeatures ?? selection.value))
const groups = computed(() => [...new Set([...effective.value.networks.map(network => network.vnet), ...effective.value.vms.map(vm => vm.bridge || 'Unattached')])]
  .map(bridge => ({ bridge, network: effective.value.networks.find(network => network.vnet === bridge), vms: effective.value.vms.filter(vm => (vm.bridge || 'Unattached') === bridge) })))
const resources = computed(() => effective.value.vms.reduce((total, vm) => ({ cores: total.cores + (vm.cores || 0), memory: total.memory + (vm.memory_mib || 0), disk: total.disk + (vm.disk_gib || 0) }), { cores: 0, memory: 0, disk: 0 }))
</script>

<template>
  <section class="rounded-xl border border-base-300 bg-base-100 p-4 mb-4 space-y-4" data-testid="native-scenario-preview">
    <header><h2 class="font-semibold text-lg">Deployment preview</h2>
      <p class="text-sm text-base-content/70">Declared resources from this scenario revision. Confirm the environment and features in Deploy; preflight checks the target before execution.</p>
    </header>
    <fieldset v-if="features?.length && selectedFeatures === undefined" class="space-y-2">
      <legend class="text-sm font-medium">Preview features</legend>
      <label v-for="feature in features" :key="feature.id" class="flex items-center gap-2 text-sm">
        <input v-model="selection[feature.id]" type="checkbox" class="checkbox checkbox-sm" :data-testid="`preview-feature-${feature.id}`" />{{ feature.label || feature.id }}
      </label>
    </fieldset>
    <p class="text-sm" data-testid="native-resource-summary">{{ effective.vms.length }} VMs · {{ effective.networks.length }} networks<span v-if="resources.cores"> · {{ resources.cores }} vCPUs · {{ resources.memory / 1024 }} GiB RAM · {{ resources.disk }} GiB disk</span></p>
    <div v-for="group in groups" :key="group.bridge" class="rounded-lg border border-base-300 bg-base-200/40 p-3" :data-testid="`native-network-${group.bridge}`">
      <div class="text-center text-sm font-medium"><span aria-hidden="true">◇ </span>{{ group.bridge }} <span class="font-mono">{{ group.network?.subnet }}</span><span v-if="group.network?.gateway" class="text-xs"> · gateway {{ group.network.gateway }}</span></div>
      <div class="mx-auto h-4 border-l-2 border-primary w-0" aria-hidden="true" />
      <div class="grid gap-3 border-t-2 border-primary pt-3 sm:grid-cols-2 lg:grid-cols-3">
        <article v-for="vm in group.vms" :key="vm.vm_id" class="rounded-lg border border-base-300 bg-base-100 p-3 min-w-0">
          <h3 class="font-medium break-words">{{ vm.vm_name || `VM ${vm.vm_id}` }}</h3>
          <p class="text-xs text-base-content/70">{{ vm.group || vm.role }} · VM {{ vm.vm_id }}</p>
          <p class="text-sm font-mono">{{ vm.ip }}</p>
          <p v-if="vm.cores || vm.memory_mib || vm.disk_gib" class="text-xs mt-1">{{ vm.cores ?? '—' }} vCPU · {{ vm.memory_mib ? vm.memory_mib / 1024 : '—' }} GiB RAM · {{ vm.disk_gib ?? '—' }} GiB disk</p>
        </article>
      </div>
    </div>
    <p v-if="!effective.vms.length" class="text-sm">No VMs declared for these features.</p>
    <p v-for="warning in topology.warnings || []" :key="warning" class="text-xs text-base-content/70">{{ warning }}</p>
  </section>
</template>
