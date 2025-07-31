import { sqlite3Worker1Promiser } from '@sqlite.org/sqlite-wasm'
import { ref } from 'vue'

const databaseConfig = {
  filename: 'file:mydb.sqlite3?vfs=opfs',
  tables: {
    test: {
      name: 'test_table',
      schema: `
        CREATE TABLE IF NOT EXISTS test_table (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `,
    },
  },
}

const isInitialized = ref(false)

export function useSQLite() {
  const isLoading = ref(false)
  const error = ref(null)
  let promiser = null
  let dbId = null

  const log = (...args) => console.log(...args)

  const initializePromiser = async () => {
    return new Promise((resolve) => {
      const _promiser = sqlite3Worker1Promiser({
        onready: () => resolve(_promiser),
      })
    })
  }

  const openDatabase = async (p) => {
    const response = await p('open', { filename: databaseConfig.filename })
    if (response.type === 'error')
      throw new Error(response.result.message)
    return response.result.dbId
  }

  const initialize = async () => {
    if (isInitialized.value)
      return true

    isLoading.value = true
    error.value = null

    try {
      log('Initializing SQLite database...')
      promiser = await initializePromiser()
      if (!promiser)
        throw new Error('Failed to initialize promiser')

      await promiser('config-get', {})
      dbId = await openDatabase(promiser)
      log('Database opened successfully with ID:', dbId)

      await promiser('exec', {
        dbId,
        sql: databaseConfig.tables.test.schema,
      })

      isInitialized.value = true
      return true
    } catch (err) {
      error.value = err instanceof Error
        ? `Failed to initialize SQLite database: ${err.message}`
        : 'Failed to initialize SQLite database'
      throw error.value
    } finally {
      isLoading.value = false
    }
  }

  const executeQuery = async (sql, params = []) => {
    if (!dbId || !promiser)
      await initialize()

    isLoading.value = true
    error.value = null

    try {
      log('Executing query:', sql, 'with params:', params)
      const result = await promiser('exec', {
        dbId,
        sql,
        bind: params,
        returnValue: 'resultRows',
      })

      log('Query result:', result)

      if (result.type === 'error')
        throw new Error(result.result.message)

      return result
    } catch (err) {
      error.value = err instanceof Error
        ? `Query execution failed: ${err.message}`
        : 'Query execution failed'
      throw error.value
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    error,
    isInitialized,
    executeQuery,
  }
}
