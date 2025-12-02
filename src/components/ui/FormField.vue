<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number, Boolean],
    default: ''
  },
  label: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'text'
  },
  placeholder: {
    type: String,
    default: ''
  },
  hint: {
    type: String,
    default: ''
  },
  error: {
    type: String,
    default: ''
  },
  required: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  icon: {
    type: String,
    default: ''
  },
  min: {
    type: [Number, String],
    default: undefined
  },
  max: {
    type: [Number, String],
    default: undefined
  },
  rows: {
    type: Number,
    default: 3
  },
  options: {
    type: Array,
    default: () => []
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue'])

const isFocused = ref(false)

const inputValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const hasValue = computed(() => {
  return props.modelValue !== '' && props.modelValue !== null && props.modelValue !== undefined
})

const inputClasses = computed(() => {
  const base = props.type === 'textarea' 
    ? 'textarea textarea-bordered' 
    : props.type === 'select' 
      ? 'select select-bordered'
      : props.type === 'checkbox'
        ? 'toggle'
        : 'input input-bordered'
  
  const sizeClass = props.size === 'sm' ? `${base.split(' ')[0]}-sm` : props.size === 'lg' ? `${base.split(' ')[0]}-lg` : ''
  
  return [
    base,
    sizeClass,
    props.error ? 'input-error border-error' : '',
    isFocused.value ? 'ring-2 ring-primary/20' : '',
    props.icon && props.type !== 'select' ? 'pl-10' : '',
    'w-full transition-all duration-200'
  ].filter(Boolean).join(' ')
})

const wrapperClasses = computed(() => [
  'form-control relative group',
  props.disabled ? 'opacity-60 cursor-not-allowed' : ''
].filter(Boolean).join(' '))

const labelClasses = computed(() => [
  'label-text font-medium transition-colors duration-200',
  isFocused.value ? 'text-primary' : '',
  props.error ? 'text-error' : ''
].filter(Boolean).join(' '))
</script>

<template>
  <div :class="wrapperClasses">
    <!-- Label -->
    <label v-if="type !== 'checkbox'" class="label pb-1">
      <span :class="labelClasses">
        <span v-if="icon" class="mr-1">{{ icon }}</span>
        {{ label }}
        <span v-if="required" class="text-error ml-0.5">*</span>
      </span>
      <span v-if="hint && !error" class="label-text-alt text-xs opacity-60">{{ hint }}</span>
      <span v-if="error" class="label-text-alt text-xs text-error font-medium">{{ error }}</span>
    </label>

    <!-- Input with icon wrapper -->
    <div class="relative">
      <!-- Icon -->
      <span 
        v-if="icon && type !== 'select' && type !== 'checkbox' && type !== 'textarea'" 
        class="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40 group-focus-within:text-primary transition-colors z-10"
      >
        {{ icon }}
      </span>

      <!-- Text Input -->
      <input
        v-if="type === 'text' || type === 'number' || type === 'password' || type === 'email' || type === 'url'"
        v-model="inputValue"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :min="min"
        :max="max"
        :class="inputClasses"
        @focus="isFocused = true"
        @blur="isFocused = false"
      />

      <!-- Textarea -->
      <textarea
        v-else-if="type === 'textarea'"
        v-model="inputValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :rows="rows"
        :class="inputClasses"
        @focus="isFocused = true"
        @blur="isFocused = false"
      ></textarea>

      <!-- Select -->
      <select
        v-else-if="type === 'select'"
        v-model="inputValue"
        :disabled="disabled"
        :class="inputClasses"
        @focus="isFocused = true"
        @blur="isFocused = false"
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option 
          v-for="opt in options" 
          :key="typeof opt === 'object' ? opt.value : opt"
          :value="typeof opt === 'object' ? opt.value : opt"
        >
          {{ typeof opt === 'object' ? opt.label : opt }}
        </option>
      </select>

      <!-- Checkbox/Toggle -->
      <label v-else-if="type === 'checkbox'" class="label cursor-pointer justify-start gap-3 py-2">
        <input
          type="checkbox"
          v-model="inputValue"
          :disabled="disabled"
          class="toggle toggle-primary"
          @focus="isFocused = true"
          @blur="isFocused = false"
        />
        <span :class="labelClasses">
          <span v-if="icon" class="mr-1">{{ icon }}</span>
          {{ label }}
        </span>
      </label>

      <!-- Focus ring indicator -->
      <div 
        v-if="isFocused && type !== 'checkbox'" 
        class="absolute inset-0 rounded-lg ring-2 ring-primary/20 pointer-events-none"
      ></div>
    </div>

    <!-- Bottom hint (only when no error) -->
    <label v-if="type !== 'checkbox' && $slots.hint" class="label pt-1">
      <span class="label-text-alt text-xs opacity-60">
        <slot name="hint"></slot>
      </span>
    </label>
  </div>
</template>

<style scoped>
/* Enhanced focus transitions */
.form-control input:focus,
.form-control textarea:focus,
.form-control select:focus {
  outline: none;
  border-color: oklch(var(--p));
}

/* Smooth transitions */
.form-control input,
.form-control textarea,
.form-control select {
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

/* Better placeholder styling */
.form-control input::placeholder,
.form-control textarea::placeholder {
  color: oklch(var(--bc) / 0.4);
}
</style>
