export const databaseConfig = {
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
};
