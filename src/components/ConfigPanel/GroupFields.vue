<script setup>
import FormSection from '@/components/ui/FormSection.vue'
import FormField from '@/components/ui/FormField.vue'
const config = defineModel({ type: Object, required: true })
</script>

<template>
  <!-- Group kind (topology_group | team_scope) -->
  <FormSection variant="bordered" :columns="1" title="Group kind">
    <FormField
      v-model="config.kind"
      label="Kind"
      type="select"
      :options="[
        { value: 'topology_group', label: 'Topology group (static)' },
        { value: 'team_scope', label: 'Team scope (replicated per team)' },
      ]"
      hint="team_scope replicates its contents N times at deploy."
      icon=""
    />
    <FormField
      v-if="config.kind === 'team_scope'"
      v-model.number="config.team_count"
      label="Team count"
      type="number"
      :min="1"
      :max="64"
      placeholder="e.g., 4"
      hint="Number of teams to replicate this scope for at deploy."
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="2">
    <FormField
      v-model="config.prefix"
      label="Prefix"
      type="text"
      placeholder="e.g., lab1, prod, dev"
      hint="Applied to all items in this group"
      icon=""
    />
    <FormField
      v-model="config.resourcePool"
      label="Resource Pool"
      type="text"
      placeholder="Proxmox resource pool name"
      icon=""
    />
  </FormSection>

  <FormSection variant="bordered" :columns="1">
    <FormField
      v-model="config.description"
      label="Description"
      type="textarea"
      placeholder="Describe this group..."
      :rows="2"
      icon=""
    />
    <FormField
      v-model="config.tagsString"
      label="Tags"
      type="text"
      placeholder="e.g., production, web-tier, database"
      hint="Comma-separated list of tags"
      icon=""
    />
  </FormSection>
</template>
