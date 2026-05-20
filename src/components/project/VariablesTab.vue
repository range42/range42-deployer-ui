<script setup>
/**
 * VariablesTab — flat table view of the `env[]` exposed by the effective
 * (base ⊕ overlay) project document.
 *
 * Columns: name, scope (shared|per_team), required (bullet), secret
 * (mask icon), default, override (overlay-only).
 *
 * Inline edits to the "override" column write back to
 * `overlay.param_overrides.env[name]` and emit `update:overlay` so the
 * parent ProjectEditor can autosave via the adapter.
 */
import { computed, ref } from 'vue'

const props = defineProps({
  base: { type: Object, default: () => ({}) }, // CatalogEntry
  overlay: { type: Object, default: () => ({}) }, // ProjectOverlay
})
const emit = defineEmits(['update:overlay'])

const revealed = ref(new Set())

function toggleReveal(name) {
  const next = new Set(revealed.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  revealed.value = next
}

const envFromOverlay = computed(() => {
  const ov = props.overlay?.param_overrides?.env
  return ov && typeof ov === 'object' ? ov : {}
})

const rows = computed(() => {
  const baseEnv = Array.isArray(props.base?.env) ? props.base.env : []
  return baseEnv.map((v) => {
    const override = Object.prototype.hasOwnProperty.call(envFromOverlay.value, v.name)
      ? envFromOverlay.value[v.name]
      : undefined
    return {
      name: v.name,
      scope: v.scope || 'shared',
      required: !!v.required,
      secret: !!v.secret,
      defaultValue: v.default,
      hasOverride: override !== undefined,
      override,
    }
  })
})

function setOverride(name, value) {
  const next = {
    ...props.overlay,
    param_overrides: {
      ...(props.overlay?.param_overrides || {}),
      env: {
        ...envFromOverlay.value,
        [name]: value,
      },
    },
  }
  emit('update:overlay', next)
}

function clearOverride(name) {
  const nextEnv = { ...envFromOverlay.value }
  delete nextEnv[name]
  const next = {
    ...props.overlay,
    param_overrides: {
      ...(props.overlay?.param_overrides || {}),
      env: nextEnv,
    },
  }
  emit('update:overlay', next)
}

function displayValue(row) {
  if (row.secret && !revealed.value.has(row.name)) return '••••••••'
  const val = row.hasOverride ? row.override : row.defaultValue
  return val == null ? '' : String(val)
}

function onEditInput(event, name) {
  setOverride(name, event.target.value)
}
</script>

<template>
  <div class="variables-tab p-2 h-full min-h-0 overflow-y-auto" data-testid="tab-variables-body">
    <div class="flex items-center gap-2 mb-2">
      <h2 class="font-semibold">
        {{ $t ? $t('variablesTab.title') : 'Variables' }}
      </h2>
      <span class="text-xs text-base-content/60">
        {{ $t ? $t('variablesTab.subtitle') : 'Environment variables declared by the project (base ⊕ overlay)' }}
      </span>
    </div>

    <table class="table table-sm" data-testid="variables-table">
      <thead>
        <tr>
          <th>{{ $t ? $t('variablesTab.name') : 'Name' }}</th>
          <th>{{ $t ? $t('variablesTab.scope') : 'Scope' }}</th>
          <th class="w-16">{{ $t ? $t('variablesTab.required') : 'Required' }}</th>
          <th class="w-16">{{ $t ? $t('variablesTab.secret') : 'Secret' }}</th>
          <th>{{ $t ? $t('variablesTab.default') : 'Default' }}</th>
          <th>{{ $t ? $t('variablesTab.override') : 'Override (overlay only)' }}</th>
          <th class="w-10" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.name" :data-name="row.name">
          <td class="font-mono text-xs">{{ row.name }}</td>
          <td>
            <span
              class="badge"
              :class="row.scope === 'per_team' ? 'badge-accent' : 'badge-ghost'"
            >
              {{ row.scope }}
            </span>
          </td>
          <td>
            <span v-if="row.required" class="text-error" :title="$t ? $t('variablesTab.requiredHint') : 'Required'">
              &#9679;
            </span>
            <span v-else>&middot;</span>
          </td>
          <td>
            <button
              v-if="row.secret"
              type="button"
              class="btn btn-ghost btn-xs"
              :aria-label="$t ? $t('variablesTab.revealSecret') : 'Toggle secret visibility'"
              @click="toggleReveal(row.name)"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <span v-else>&middot;</span>
          </td>
          <td class="font-mono text-xs">{{ displayValue(row) }}</td>
          <td>
            <input
              type="text"
              class="input input-xs input-bordered w-full font-mono"
              :value="row.hasOverride ? String(row.override ?? '') : ''"
              :placeholder="row.hasOverride ? '' : (row.defaultValue != null ? String(row.defaultValue) : '')"
              :data-testid="`override-${row.name}`"
              @input="onEditInput($event, row.name)"
            />
          </td>
          <td>
            <button
              v-if="row.hasOverride"
              type="button"
              class="btn btn-ghost btn-xs"
              :aria-label="$t ? $t('variablesTab.clearOverride') : 'Clear override'"
              :data-testid="`clear-${row.name}`"
              @click="clearOverride(row.name)"
            >
              &times;
            </button>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="7" class="text-center italic text-base-content/60">
            {{ $t ? $t('variablesTab.empty') : 'No env variables declared by this project.' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
