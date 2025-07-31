<template>
  <div class="example-queries">
    <h3>Example Queries</h3>
    <div class="query-buttons">
      <button
        v-for="(query, index) in exampleQueries"
        :key="index"
        @click="$emit('select-query', query.sql)"
        class="query-button"
      >
        {{ query.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
const exampleQueries = [
  {
    label: 'Select All',
    sql: 'SELECT * FROM test_table;'
  },
  {
    label: 'Insert Row',
    sql: "INSERT INTO test_table (name) VALUES ('New Item');"
  },
  {
    label: 'Update Row',
    sql: "UPDATE test_table SET name = 'Updated Name' WHERE id = 1;"
  },
  {
    label: 'Delete Row',
    sql: 'DELETE FROM test_table WHERE id = 1;'
  },
  {
    label: 'Count Records',
    sql: 'SELECT COUNT(*) as count FROM test_table;'
  },
  {
    label: 'Latest Records',
    sql: 'SELECT * FROM test_table ORDER BY created_at DESC LIMIT 5;'
  }
]

// Replace TypeScript type definition with a plain call
const emit = defineEmits(['select-query'])
</script>

<style scoped>
.example-queries {
  margin: 1rem 0;
}

.query-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.query-button {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #f5f5f5;
  cursor: pointer;
}

.query-button:hover {
  background-color: #e0e0e0;
}
</style>
