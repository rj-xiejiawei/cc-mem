import type { Database as SqlJsDatabase } from 'sql.js'

const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      project_path TEXT,
      started_at TEXT,
      ended_at TEXT,
      summary TEXT,
      discovery_tokens INTEGER DEFAULT 0
    )`,
    `CREATE TABLE observations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      narrative TEXT,
      facts TEXT,
      concepts TEXT,
      files_read TEXT,
      files_modified TEXT,
      project TEXT NOT NULL,
      content_hash TEXT,
      prompt_number INTEGER,
      status TEXT NOT NULL DEFAULT 'confirmed',
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      discovery_tokens INTEGER DEFAULT 0
    )`,
    `CREATE INDEX idx_observations_project ON observations(project)`,
    `CREATE INDEX idx_observations_session ON observations(session_id)`,
    `CREATE INDEX idx_observations_created ON observations(created_at)`,
    `CREATE INDEX idx_observations_type ON observations(type)`,
    `CREATE INDEX idx_observations_status ON observations(status)`,
    `CREATE INDEX idx_observations_hash ON observations(content_hash)`,
    `CREATE INDEX idx_sessions_project ON sessions(project)`,
    `CREATE VIRTUAL TABLE observations_fts USING fts5(title, narrative, facts, concepts)`,
    `CREATE TRIGGER observations_fts_insert AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
      VALUES (NEW.rowid, NEW.title, NEW.narrative, NEW.facts, NEW.concepts);
    END`,
    `CREATE TRIGGER observations_fts_update AFTER UPDATE ON observations BEGIN
      DELETE FROM observations_fts WHERE rowid = OLD.rowid;
      INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
      VALUES (NEW.rowid, NEW.title, NEW.narrative, NEW.facts, NEW.concepts);
    END`,
    `CREATE TRIGGER observations_fts_delete AFTER DELETE ON observations BEGIN
      DELETE FROM observations_fts WHERE rowid = OLD.rowid;
    END`,
    `CREATE TABLE user_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id),
      content TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  ],
}

export function runMigrations(db: SqlJsDatabase): void {
  let currentVersion = 0
  let fts5Supported = true

  try {
    const result = db.exec('SELECT MAX(version) FROM schema_versions')
    if (result[0]?.values[0]?.[0]) {
      currentVersion = result[0].values[0][0] as number
    }
  } catch {
    // Table doesn't exist yet
  }

  // Check if FTS5 is supported
  try {
    db.run('CREATE VIRTUAL TABLE IF NOT EXISTS fts5_test USING fts5(test)')
    db.run('DROP TABLE IF EXISTS fts5_test')
  } catch {
    fts5Supported = false
  }

  for (const [version, statements] of Object.entries(MIGRATIONS)) {
    const v = Number(version)
    if (v > currentVersion) {
      for (const sql of statements) {
        // Skip FTS5-related statements if not supported
        if (!fts5Supported && (sql.includes('fts5') || sql.includes('observations_fts'))) {
          continue
        }
        try {
          db.run(sql)
        } catch (e) {
          // Skip FTS5 statements if not supported (e.g., in sql.js without FTS5)
          if (!String(e).includes('no such module') && !String(e).includes('no such table')) {
            throw e
          }
        }
      }
      db.run(
        'INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)',
        [v, new Date().toISOString()]
      )
    }
  }
}
