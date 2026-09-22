<script setup>
import { computed } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { getNetworkColor } from '@/constants/networkColors'
import { connectedNetworkDevices } from '@/services/networkConnections'

const props = defineProps(['id', 'data', 'selected', 'connectable'])
const { getEdges, findNode } = useVueFlow()
const { t } = useI18n()
const config = computed(() => props.data?.config || {})
const segmentType = computed(() => ['wan', 'lan', 'dmz', 'management'].includes(config.value.segmentType)
  ? config.value.segmentType : 'custom')
const color = computed(() => getNetworkColor(segmentType.value))
const devices = computed(() => {
  const ids = new Set(getEdges.value.flatMap(edge => [edge.source, edge.target]))
  const nodes = [...ids].map(id => findNode(id)).filter(Boolean)
  return connectedNetworkDevices(props.id, nodes, getEdges.value)
})
const statusColor = computed(() => ({ green: '#22c55e', orange: '#f59e0b', red: '#ef4444', blue: '#3b82f6' })[props.data?.status] || '#94a3b8')
const targets = [
  { id: 'top-1', position: Position.Top, style: { left: '25%' } },
  { id: 'top-2', position: Position.Top, style: { left: '50%' } },
  { id: 'top-3', position: Position.Top, style: { left: '75%' } },
  { id: 'bottom-1', position: Position.Bottom, style: { left: '25%' } },
  { id: 'bottom-2', position: Position.Bottom, style: { left: '50%' } },
  { id: 'bottom-3', position: Position.Bottom, style: { left: '75%' } },
  { id: 'left-1', position: Position.Left, style: { top: '35%' } },
  { id: 'left-2', position: Position.Left, style: { top: '65%' } },
  { id: 'right-1', position: Position.Right, style: { top: '35%' } },
  { id: 'right-2', position: Position.Right, style: { top: '65%' } },
]
const sources = [
  { id: 'out-top', position: Position.Top, style: { left: '88%' } },
  { id: 'out-bottom', position: Position.Bottom, style: { left: '88%' } },
  { id: 'out-left', position: Position.Left, style: { top: '50%' } },
  { id: 'out-right', position: Position.Right, style: { top: '50%' } },
]
</script>

<template>
  <section class="network-segment-node" :class="{ selected }"
    :style="{ '--network-accent': color.stroke }" :data-network-type="segmentType">
    <header class="network-header">
      <div class="network-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M10 2v5m4-5v5m-4 10v5m4-5v5M2 10h5m-5 4h5m10-4h5m-5 4h5M10 10h4v4h-4z" />
        </svg>
      </div>
      <div class="min-w-0 flex-1">
        <div class="network-kind">{{ t(`configPanel.network.types.${segmentType}`) }}</div>
        <h3 class="truncate font-semibold" :title="config.name || data?.label">{{ config.name || data?.label || t('configPanel.network.title') }}</h3>
      </div>
      <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: statusColor }" aria-hidden="true" />
    </header>
    <div class="network-address" :class="{ 'text-sm opacity-60': !config.cidr }">
      {{ config.cidr || t('configPanel.network.noAddress') }}
    </div>
    <dl class="network-details">
      <div><dt>{{ t('configPanel.network.bridge') }}</dt><dd>{{ config.bridge || '—' }}</dd></div>
      <div v-if="config.vlan != null && config.vlan !== ''"><dt>VLAN</dt><dd>{{ config.vlan }}</dd></div>
      <div v-if="config.gateway" class="network-gateway"><dt>{{ t('configPanel.fields.gateway') }}</dt><dd>{{ config.gateway }}</dd></div>
    </dl>
    <p v-if="config.description" class="px-4 pb-3 text-xs text-base-content/60 line-clamp-2">{{ config.description }}</p>
    <footer class="network-footer">
      <span class="size-1.5 rounded-full" :style="{ backgroundColor: color.stroke }" aria-hidden="true" />
      {{ t('configPanel.network.devices', devices.length) }}
    </footer>
    <Handle v-for="port in targets" :key="port.id" :id="port.id" type="target"
      :position="port.position" :style="port.style" :connectable="connectable" class="network-port" />
    <Handle v-for="port in sources" :key="port.id" :id="port.id" type="source"
      :position="port.position" :style="port.style" :connectable="connectable" class="network-port network-port-source" />
  </section>
</template>

<style scoped>
:global(.vue-flow__node-network-segment) { width: 280px; }
.network-segment-node {
  width: 100%; height: 100%; min-width: 240px; border: 1px solid var(--color-base-300);
  border-top: 3px solid var(--network-accent); border-radius: 12px;
  color: var(--color-base-content); background: var(--color-base-100);
  box-shadow: 0 3px 12px #0000000a;
}
.network-segment-node.selected { outline: 2px solid var(--network-accent); outline-offset: 3px; }
.network-header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 12px; }
.network-icon { padding: 7px; border-radius: 8px; color: var(--network-accent); background: color-mix(in srgb, var(--network-accent) 10%, transparent); }
.network-icon svg { width: 21px; height: 21px; }
.network-kind { font-size: 10px; line-height: 1.6; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--network-accent); }
.network-address { margin: 0 16px 12px; font: 600 16px/1.5 ui-monospace, monospace; overflow-wrap: anywhere; }
.network-details { display: flex; flex-wrap: wrap; gap: 8px 20px; padding: 0 16px 14px; font-size: 11px; }
.network-details > div { display: flex; align-items: baseline; gap: 8px; }
.network-details dt { opacity: .6; }
.network-details dd { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
.network-gateway { width: 100%; }
.network-footer { display: flex; align-items: center; gap: 7px; padding: 9px 16px; border-top: 1px solid var(--color-base-300); font-size: 11px; }
.network-port { width: 9px; height: 9px; border: 2px solid var(--color-base-100); background: var(--network-accent); opacity: .55; }
.network-port-source { width: 11px; height: 11px; border-radius: 3px; opacity: .85; }
.network-segment-node:hover .network-port, .network-segment-node.selected .network-port { opacity: 1; }
</style>
