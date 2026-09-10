<script setup>
import FormDivider from '@/components/ui/FormDivider.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
// Add firewall rule management (Proxmox-compatible format)
const addFirewallRule = () => {
  if (!config.value.rules) config.value.rules = []
  config.value.rules.push({
    action: 'ACCEPT',
    direction: 'in',
    source: '',
    dest: '',
    dport: '',
    proto: 'tcp',
    comment: '',
    enabled: true
  })
}

const removeFirewallRule = (index) => {
  config.value.rules.splice(index, 1)
}


</script>

<template>
  <FormDivider label="Firewall Features" icon="" />

  <FormSection variant="bordered" :columns="3">
    <FormField
      v-model="config.natEnabled"
      label="Enable NAT"
      type="checkbox"
      icon=""
    />
    <FormField
      v-model="config.vpnSupport"
      label="VPN Support"
      type="checkbox"
      icon=""
    />
    <FormField
      v-model="config.intrusionDetection"
      label="Intrusion Detection"
      type="checkbox"
      icon=""
    />
  </FormSection>

  <!-- Enhanced Firewall Rules Builder -->
  <FormDivider label="Firewall Rules" icon="" />

  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="font-medium text-sm">Rules</span>
      <button type="button" @click="addFirewallRule" class="btn btn-sm btn-primary gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Add Rule
      </button>
    </div>

    <!-- Rules Header -->
    <div v-if="config.rules?.length" class="hidden md:grid grid-cols-12 gap-2 px-4 py-2 bg-base-200/70 rounded-lg text-xs font-semibold text-base-content/60">
      <div class="col-span-1">#</div>
      <div class="col-span-1">Action</div>
      <div class="col-span-1">Dir</div>
      <div class="col-span-2">Source</div>
      <div class="col-span-2">Destination</div>
      <div class="col-span-1">Port</div>
      <div class="col-span-1">Proto</div>
      <div class="col-span-2">Comment</div>
      <div class="col-span-1"></div>
    </div>

    <TransitionGroup
      v-if="config.rules?.length"
      tag="div"
      class="space-y-2"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-for="(rule, index) in config.rules"
        :key="rule.id || index"
        class="group bg-base-200/30 border border-base-300 rounded-lg p-3 hover:border-primary/30 transition-all duration-200"
        :class="{ 'opacity-40 bg-base-300/20': rule.enabled === false }"
      >
        <!-- Rule Row -->
        <div class="grid grid-cols-2 md:grid-cols-12 gap-2 items-center">
          <!-- Position -->
          <div class="hidden md:flex col-span-1 text-sm font-mono text-base-content/40">
            {{ index + 1 }}
          </div>

          <!-- Action -->
          <select
            v-model="rule.action"
            class="select select-bordered select-sm col-span-1 font-medium"
            :class="{
              'bg-success/10 border-success/30 text-success': rule.action === 'ACCEPT',
              'bg-error/10 border-error/30 text-error': rule.action === 'DROP' || rule.action === 'REJECT'
            }"
          >
            <option value="ACCEPT">Allow</option>
            <option value="DROP">Drop</option>
            <option value="REJECT">Reject</option>
          </select>

          <!-- Direction -->
          <select v-model="rule.direction" class="select select-bordered select-sm col-span-1">
            <option value="in">In</option>
            <option value="out">Out</option>
          </select>

          <!-- Source -->
          <input
            v-model="rule.source"
            type="text"
            class="input input-bordered input-sm col-span-2 focus:input-primary"
            placeholder="any / CIDR"
          />

          <!-- Destination -->
          <input
            v-model="rule.dest"
            type="text"
            class="input input-bordered input-sm col-span-2 focus:input-primary"
            placeholder="any / CIDR"
          />

          <!-- Port -->
          <input
            v-model="rule.dport"
            type="text"
            class="input input-bordered input-sm col-span-1 focus:input-primary"
            placeholder="80,443"
          />

          <!-- Protocol -->
          <select v-model="rule.proto" class="select select-bordered select-sm col-span-1">
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
            <option value="icmp">ICMP</option>
            <option value="">Any</option>
          </select>

          <!-- Comment -->
          <input
            v-model="rule.comment"
            type="text"
            class="input input-bordered input-sm col-span-2 focus:input-primary"
            placeholder="Description"
          />

          <!-- Actions -->
          <div class="col-span-1 flex gap-1 justify-end">
            <label class="swap swap-rotate">
              <input type="checkbox" v-model="rule.enabled" />
              <svg class="swap-on w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <svg class="swap-off w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </label>
            <button
              type="button"
              @click="removeFirewallRule(index)"
              class="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </TransitionGroup>

    <!-- Empty State -->
    <div v-else class="text-center py-8 border-2 border-dashed border-base-300 rounded-lg bg-base-200/30">
      <svg class="w-12 h-12 mx-auto mb-3 text-base-content/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
      <p class="text-base-content/50">No firewall rules configured</p>
      <p class="text-sm text-base-content/30 mt-1">Click "Add Rule" to create your first rule</p>
    </div>
  </div>
</template>
