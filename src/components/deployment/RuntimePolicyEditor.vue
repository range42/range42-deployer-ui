<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({ deploymentId: { type: String, required: true }, chains: { type: Array, required: true }, disabled: Boolean })
const emit = defineEmits(['review'])
const { t } = useI18n()
const key = chain => `${chain.scope}-${chain.vm_id || ''}`
const choices = computed(() => props.chains.filter(chain => chain.available))
const selected = ref('')
const chain = computed(() => choices.value.find(value => key(value) === selected.value))
const editPosition = ref(null)
const rule = reactive({ name: '', direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '', source: '', destination: '', enabled: true })
const alias = reactive({ name: '', cidr: '', new_name: '', action: 'create' })
const target = value => ({ scope: value.scope, ...(value.scope === 'vm' ? { vm_id: value.vm_id } : {}) })
const ownsAlias = value => value.comment === `range42-deployment:${props.deploymentId}`
const ownsRule = value => value.comment?.startsWith(`range42-deployment:${props.deploymentId};rule:`)
function editableRule(value, scope) {
  if (!ownsRule(value) || !['in', 'out'].includes(value.direction) || !['tcp', 'udp'].includes(value.protocol)) return false
  if (value.direction === 'out' || value.macro) return false
  if (value.protocol === 'udp') return true
  if (!/^[0-9:,]+$/.test(value.destination_port || '')) return false
  return !value.destination_port.split(',').some(part => {
    const ports = part.split(':').map(Number)
    return (scope === 'vm' ? [22] : [22, 8006]).some(port => ports[0] <= port && ports.at(-1) >= port)
  })
}
function review(value) { if (!props.disabled) emit('review', value) }
function edit(value, current) {
  if (props.disabled) return
  selected.value = key(value)
  editPosition.value = current.position
  Object.assign(rule, { name: '', direction: current.direction, action: current.action, protocol: current.protocol,
    destination_port: current.destination_port, source: current.source || '', destination: current.destination || '', enabled: current.enabled })
}
function rename(value, current) {
  if (props.disabled) return
  selected.value = key(value)
  Object.assign(alias, { name: current.name, cidr: current.cidr, new_name: '', action: 'rename' })
}
function submitRule() {
  if (!chain.value || props.disabled) return
  review({ kind: 'firewall_rule', ...target(chain.value), action: editPosition.value === null ? 'create' : 'update',
    ...(editPosition.value === null ? { name: rule.name.trim() } : { position: editPosition.value }),
    rule: { direction: rule.direction, action: rule.action, protocol: rule.protocol, destination_port: rule.destination_port.trim(),
      source: rule.source.trim() || null, destination: rule.destination.trim() || null, enabled: rule.enabled } })
}
function submitAlias() {
  if (!chain.value || chain.value.scope === 'node' || props.disabled) return
  review({ kind: 'firewall_alias', ...target(chain.value), action: alias.action, name: alias.name.trim(),
    ...(alias.action === 'create' ? { cidr: alias.cidr.trim() } : { new_name: alias.new_name.trim() }) })
}
function resetEditor() {
  editPosition.value = null
  Object.assign(rule, { name: '', direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '', source: '', destination: '', enabled: true })
  Object.assign(alias, { name: '', cidr: '', new_name: '', action: 'create' })
}
watch(choices, values => { if (!values.some(value => key(value) === selected.value)) { selected.value = values[0] ? key(values[0]) : ''; resetEditor() } }, { immediate: true })
</script>

<template>
  <section class="space-y-3 border-t border-base-300 pt-3">
    <h3 class="font-semibold">{{ t('runtime.policy.title') }}</h3>
    <p class="text-sm">{{ t('runtime.policy.scopeHint') }}</p>
    <div v-for="value in choices" :key="key(value)" class="space-y-2">
      <h4 class="text-sm font-semibold">{{ t(`runtime.report.scopes.${value.scope}`) }} {{ value.vm_id }}</h4>
      <div v-for="entry in value.rules.filter(entry => editableRule(entry, value.scope))" :key="entry.position" class="flex flex-wrap items-center gap-2 text-xs">
        <span>#{{ entry.position }} · {{ entry.direction }} · {{ entry.action }} · {{ entry.protocol }} · {{ entry.destination_port }}</span>
        <button type="button" class="btn btn-xs btn-outline" :data-testid="`policy-edit-${key(value)}-${entry.position}`" :disabled="disabled" @click="edit(value, entry)">{{ t('runtime.policy.edit') }}</button>
        <button type="button" class="btn btn-xs btn-outline" :disabled="disabled" @click="review({ kind: 'firewall_rule', ...target(value), action: 'delete', position: entry.position })">{{ t('runtime.policy.delete') }}</button>
        <button type="button" class="btn btn-xs btn-ghost" :disabled="disabled || entry.position === 0" @click="review({ kind: 'firewall_rule', ...target(value), action: 'move', position: entry.position, move_to: entry.position - 1 })">{{ t('runtime.policy.up') }}</button>
        <button type="button" class="btn btn-xs btn-ghost" :data-testid="`policy-down-${key(value)}-${entry.position}`" :disabled="disabled || entry.position === value.rules.length - 1" @click="review({ kind: 'firewall_rule', ...target(value), action: 'move', position: entry.position, move_to: entry.position + 1 })">{{ t('runtime.policy.down') }}</button>
      </div>
      <div v-for="entry in value.aliases.filter(ownsAlias)" :key="entry.name" class="flex flex-wrap items-center gap-2 text-xs">
        <span>{{ entry.name }} · {{ entry.cidr }}</span>
        <button type="button" class="btn btn-xs btn-outline" :data-testid="`alias-rename-${key(value)}-${entry.name}`" :disabled="disabled" @click="rename(value, entry)">{{ t('runtime.policy.rename') }}</button>
        <button type="button" class="btn btn-xs btn-outline" :data-testid="`alias-delete-${key(value)}-${entry.name}`" :disabled="disabled" @click="review({ kind: 'firewall_alias', ...target(value), action: 'delete', name: entry.name })">{{ t('runtime.policy.delete') }}</button>
      </div>
    </div>
    <template v-if="chain">
      <label class="block text-sm">{{ t('runtime.policy.target') }}
        <select v-model="selected" class="select select-bordered select-sm w-full mt-1" :disabled="disabled" @change="resetEditor">
          <option v-for="value in choices" :key="key(value)" :value="key(value)">{{ t(`runtime.report.scopes.${value.scope}`) }} {{ value.vm_id }}</option>
        </select>
      </label>
      <form data-testid="policy-rule-form" class="space-y-2 rounded bg-base-200/60 p-3" @submit.prevent="submitRule">
        <h4 class="text-sm font-semibold">{{ t(editPosition === null ? 'runtime.policy.newRule' : 'runtime.policy.editRule') }} <span v-if="editPosition !== null">#{{ editPosition }}</span></h4>
        <label v-if="editPosition === null" class="block text-sm">{{ t('runtime.policy.name') }}<input v-model="rule.name" :disabled="disabled" required pattern="[A-Za-z][A-Za-z0-9_-]{0,63}" class="input input-bordered input-sm w-full" /></label>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label class="text-sm">{{ t('runtime.policy.direction') }}<select v-model="rule.direction" :disabled="disabled" class="select select-bordered select-sm w-full"><option value="in">IN</option><option value="out">OUT</option></select></label>
          <label class="text-sm">{{ t('runtime.policy.action') }}<select v-model="rule.action" :disabled="disabled" class="select select-bordered select-sm w-full"><option>ACCEPT</option><template v-if="chain.scope === 'vm' && rule.direction === 'in'"><option>DROP</option><option>REJECT</option></template></select></label>
          <label class="text-sm">{{ t('runtime.policy.protocol') }}<select v-model="rule.protocol" :disabled="disabled" class="select select-bordered select-sm w-full"><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
        </div>
        <label class="block text-sm">{{ t('runtime.policy.port') }}<input v-model="rule.destination_port" data-testid="policy-port" :disabled="disabled" required pattern="[0-9:,]+" class="input input-bordered input-sm w-full" /></label>
        <label class="block text-sm">{{ t('runtime.policy.source') }}<input v-model="rule.source" data-testid="policy-source" :disabled="disabled" class="input input-bordered input-sm w-full" /></label>
        <label class="block text-sm">{{ t('runtime.policy.destination') }}<input v-model="rule.destination" :disabled="disabled" class="input input-bordered input-sm w-full" /></label>
        <label class="flex gap-2 items-center text-sm"><input v-model="rule.enabled" type="checkbox" :disabled="disabled" class="checkbox checkbox-sm" />{{ t('runtime.enabled') }}</label>
        <div class="flex flex-wrap gap-2"><button type="submit" class="btn btn-sm btn-primary" :disabled="disabled">{{ t('runtime.policy.review') }}</button><button type="button" class="btn btn-sm btn-ghost" :disabled="disabled" @click="resetEditor">{{ t('runtime.policy.reset') }}</button></div>
      </form>
      <form v-if="chain.scope !== 'node'" data-testid="policy-alias-form" class="space-y-2 rounded bg-base-200/60 p-3" @submit.prevent="submitAlias">
        <h4 class="text-sm font-semibold">{{ t(alias.action === 'create' ? 'runtime.policy.newAlias' : 'runtime.policy.rename') }}</h4>
        <label class="block text-sm">{{ t('runtime.policy.name') }}<input v-model="alias.name" :disabled="disabled || alias.action === 'rename'" required pattern="[A-Za-z][A-Za-z0-9_-]{0,63}" class="input input-bordered input-sm w-full" /></label>
        <label v-if="alias.action === 'create'" class="block text-sm">CIDR<input v-model="alias.cidr" :disabled="disabled" required class="input input-bordered input-sm w-full" /></label>
        <label v-else class="block text-sm">{{ t('runtime.policy.newName') }}<input v-model="alias.new_name" data-testid="alias-new-name" :disabled="disabled" required pattern="[A-Za-z][A-Za-z0-9_-]{0,63}" class="input input-bordered input-sm w-full" /></label>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="disabled">{{ t('runtime.policy.review') }}</button>
      </form>
    </template>
  </section>
</template>
