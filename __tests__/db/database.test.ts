import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import fs from 'node:fs'
import os from 'node:os'

describe('Database', () => {
  let db: Database
  let dbPath: string
  let tempDir: string

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(os.tmpdir())
    dbPath = `${tempDir}/test.db`
    db = new Database(dbPath)
    await db.init()
  })

  afterEach(async () => {
    if (db) {
      await db.close()
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should create a new database file', () => {
    expect(fs.existsSync(dbPath)).toBe(true)
  })

  it('should create tables and run migrations', () => {
    const tables = db.getDb().exec("SELECT name FROM sqlite_master WHERE type='table'")
    const tableNames = tables[0]?.values.map((row) => row[0] as string) || []
    expect(tableNames).toContain('sessions')
    expect(tableNames).toContain('observations')
    // FTS5 may not be available in sql.js, so we don't check for observations_fts
  })

  it('should get database instance', () => {
    const sqlDb = db.getDb()
    expect(sqlDb).toBeDefined()
    expect(typeof sqlDb.run).toBe('function')
    expect(typeof sqlDb.exec).toBe('function')
  })

  it('should persist data to disk', async () => {
    db.getDb().run('INSERT INTO sessions (id, project, started_at) VALUES (?, ?, ?)', [
      'test-session',
      'test-project',
      '2025-01-15T10:00:00Z',
    ])
    db.persist()

    // Create a new Database instance to read from file
    const db2 = new Database(dbPath)
    await db2.init()
    const result = db2.getDb().exec('SELECT * FROM sessions WHERE id = ?', ['test-session'])
    expect(result[0]?.values.length).toBe(1)
    await db2.close()
  })

  it('should throw error when getting db before init', async () => {
    const dbPath2 = `${tempDir}/test2.db`
    const db2 = new Database(dbPath2)

    expect(() => db2.getDb()).toThrow('Database not initialized')
  })

  it('should load existing database', async () => {
    // Insert data into first instance
    db.getDb().run('INSERT INTO sessions (id, project, started_at) VALUES (?, ?, ?)', [
      'existing-session',
      'existing-project',
      '2025-01-15T10:00:00Z',
    ])
    db.persist()
    await db.close()

    // Load in new instance
    const db2 = new Database(dbPath)
    await db2.init()
    const result = db2.getDb().exec('SELECT * FROM sessions WHERE id = ?', ['existing-session'])
    expect(result[0]?.values.length).toBe(1)
    await db2.close()
  })

  it('should handle corrupted database by creating new one', async () => {
    await db.close()

    // Create a valid database first
    const validDb = new Database(dbPath)
    await validDb.init()
    validDb.close()

    // Corrupt the database file by writing invalid data
    fs.writeFileSync(dbPath, 'corrupted data that is not valid sqlite')

    const db2 = new Database(dbPath)
    // This should not throw - it should handle corruption gracefully
    await expect(db2.init()).resolves.not.toThrow()

    // Should create a new database successfully
    expect(() => db2.getDb()).not.toThrow()

    // Backup file should be created
    expect(fs.existsSync(dbPath + '.bak')).toBe(true)

    await db2.close()
  })

  it('should create nested directories if they do not exist', async () => {
    await db.close()
    const nestedPath = `${tempDir}/nested/deep/path/test.db`
    const db2 = new Database(nestedPath)
    await db2.init()

    expect(fs.existsSync(nestedPath)).toBe(true)
    await db2.close()
  })

  it('should close database and persist data', async () => {
    db.getDb().run('INSERT INTO sessions (id, project, started_at) VALUES (?, ?, ?)', [
      'close-test',
      'close-project',
      '2025-01-15T10:00:00Z',
    ])
    await db.close()

    // Reopen and verify data was persisted
    const db2 = new Database(dbPath)
    await db2.init()
    const result = db2.getDb().exec('SELECT * FROM sessions WHERE id = ?', ['close-test'])
    expect(result[0]?.values.length).toBe(1)
    await db2.close()
  })

  it('should handle multiple persist calls', () => {
    db.getDb().run('INSERT INTO sessions (id, project, started_at) VALUES (?, ?, ?)', [
      'session-1',
      'project-1',
      '2025-01-15T10:00:00Z',
    ])
    db.persist()

    db.getDb().run('INSERT INTO sessions (id, project, started_at) VALUES (?, ?, ?)', [
      'session-2',
      'project-2',
      '2025-01-15T11:00:00Z',
    ])
    db.persist()

    const result = db.getDb().exec('SELECT COUNT(*) FROM sessions')
    expect(result[0]?.values[0][0]).toBe(2)
  })
})
