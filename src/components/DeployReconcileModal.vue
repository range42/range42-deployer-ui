<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { proxmoxCache } from '@/services/proxmox/cache'
import { getBaseUrl } from '@/services/proxmox/api'
import type { VmListItem } from '@/services/proxmox/types'

const props = defineProps<{
  canvasVmIds: Set<number>
  proxmoxNode: string
}>()

const emit = defineEmits<{
  (e: 'proceed', toDelete: number[], toImport: VmListItem[]): void
  (e: 'cancel'): void
}>()

const isLoading = ref(true)
const orphanedVms = ref<(VmListItem & { action: 'keep' | 'delete' })[]>([])

onMounted(async () => {
  try {
    if (!getBaseUrl()) return
    // Unwrap in case a Ref is passed as prop
    const node = typeof props.proxmoxNode === 'string' ? props.proxmoxNode : String(props.proxmoxNode)
    const vms = await proxmoxCache.fetchVms(node as any)
    // Find VMs on Proxmox that are NOT on the canvas and NOT templates
    orphanedVms.value = vms
      .filter(v => !v.isTemplate && !props.canvasVmIds.has(v.vmid))
      .map(v => ({ ...v, action: 'keep' as const }))
  } finally {
    isLoading.value = false
  }
})

const hasOrphans = computed(() => orphanedVms.value.length > 0)
const toDelete = computed(() => orphanedVms.value.filter(v => v.action === 'delete'))
const toKeep = computed(() => orphanedVms.value.filter(v => v.action === 'keep'))

function toggleAction(vmid: number) {
  const vm = orphanedVms.value.find(v => v.vmid === vmid)
  if (vm) vm.action = vm.action === 'keep' ? 'delete' : 'keep'
}

function markAllKeep() { orphanedVms.value.forEach(v => v.action = 'keep') }
function markAllDelete() { orphanedVms.value.forEach(v => v.action = 'delete') }

function handleProceed() {
  const deleteIds = toDelete.value.map(v => v.vmid)
  const importVms = toKeep.value as VmListItem[]
  emit('proceed', deleteIds, importVms)
}

function formatRam(bytes: number) {
  const mb = Math.floor(bytes / 1024 / 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${mb}MB`
}
</script>

<template>
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl">
      <h3 class="text-lg font-bold flex items-center gap-2 mb-4">
        <span>🔄</span> Pre-Deploy Reconciliation
      </h3>

      <!-- Loading -->
      <div v-if="isLoading" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-lg"></span>
      </div>

      <!-- No orphans — clean deploy -->
      <div v-else-if="!hasOrphans" class="py-6 text-center">
        <div class="text-4xl mb-3">✅</div>
        <p class="text-lg font-medium">No conflicts detected</p>
        <p class="text-sm text-base-content/60 mt-1">No existing VMs outside your canvas. Ready to deploy.</p>
      </div>

      <!-- Orphaned VMs found -->
      <template v-else>
        <p class="text-sm text-base-content/70 mb-4">
          These <strong>{{ orphanedVms.length }} VMs</strong> exist on Proxmox but are not on your canvas.
          Choose to <span class="text-success font-medium">keep</span> (import to canvas) or
          <span class="text-error font-medium">remove</span> them.
        </p>

        <!-- Bulk actions -->
        <div class="flex gap-2 mb-3">
          <button class="btn btn-xs btn-ghost" @click="markAllKeep">Keep all</button>
          <button class="btn btn-xs btn-ghost text-error" @click="markAllDelete">Remove all</button>
          <div class="flex-1"></div>
          <span class="text-xs text-base-content/50">
            {{ toKeep.length }} keep · {{ toDelete.length }} remove
          </span>
        </div>

        <!-- VM list -->
        <div class="max-h-64 overflow-y-auto space-y-1.5">
          <div
            v-for="vm in orphanedVms"
            :key="vm.vmid"
            class="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors"
            :class="vm.action === 'delete'
              ? 'border-error/30 bg-error/5'
              : 'border-base-300 hover:border-success/30'"
            @click="toggleAction(vm.vmid)"
          >
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
              :class="vm.status === 'running' ? 'bg-success' : 'bg-base-content/20'"
            ></div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">{{ vm.name }}</div>
              <div class="text-xs text-base-content/50">
                VMID {{ vm.vmid }} · {{ vm.status }} · {{ formatRam(vm.maxmem) }}
              </div>
            </div>
            <span
              class="badge badge-sm"
              :class="vm.action === 'delete' ? 'badge-error' : 'badge-success badge-outline'"
            >
              {{ vm.action === 'delete' ? 'Remove' : 'Keep' }}
            </span>
          </div>
        </div>

        <!-- Warning for deletes -->
        <div v-if="toDelete.length > 0" class="alert alert-warning mt-4 text-sm">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{{ toDelete.length }} VM(s) will be permanently deleted from Proxmox before deployment.</span>
        </div>
      </template>

      <!-- Footer -->
      <div class="modal-action">
        <button class="btn btn-ghost" @click="emit('cancel')">Cancel</button>
        <button class="btn btn-primary" @click="handleProceed" :disabled="isLoading">
          {{ hasOrphans ? `Proceed (keep ${toKeep.length}, remove ${toDelete.length})` : 'Deploy' }}
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-black/50" @click="emit('cancel')"></div>
  </div>
</template>
