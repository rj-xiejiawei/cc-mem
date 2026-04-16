import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'
import { runMigrations } from './migrations.js'

export class Database {
  private db: SqlJsDatabase | null = null
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  async init(): Promise<void> {
    const SQL = await initSqlJs()
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath)
      try {
        this.db = new SQL.Database(buffer)
      } catch {
        // Backup corrupted file and create new database
        try {
          fs.renameSync(this.dbPath, this.dbPath + '.bak')
        } catch {
          // Ignore rename errors
        }
        this.db = new SQL.Database()
      }
    } else {
      this.db = new SQL.Database()
    }

    try {
      runMigrations(this.db)
      this.persist()
    } catch (e) {
      // If migrations fail, database might be corrupted
      try {
        fs.renameSync(this.dbPath, this.dbPath + '.bak')
      } catch {
        // Ignore rename errors
      }
      this.db = new SQL.Database()
      runMigrations(this.db)
      this.persist()
    }
  }

  getDb(): SqlJsDatabase {
    if (!this.db) throw new Error('Database not initialized')
    return this.db
  }

  persist(): void {
    if (!this.db) return
    try {
      const data = this.db.export()
      fs.writeFileSync(this.dbPath, Buffer.from(data))
    } catch (e) {
      // Handle case where db is closed during persist
      if (!String(e).includes('Database is closed')) {
        throw e
      }
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.persist()
      this.db.close()
      this.db = null
    }
  }
}
