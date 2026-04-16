import type { Database } from './database.js'

export interface Session {
  id: string
  project: string
  project_path: string | null
  started_at: string
  ended_at: string | null
  summary: string | null
  discovery_tokens: number
}

interface CreateSessionInput {
  id: string
  project: string
  project_path?: string
  started_at: string
}

interface UpdateSessionInput {
  ended_at?: string
  summary?: string
  discovery_tokens?: number
}

export class SessionsRepo {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateSessionInput): void {
    this.db
      .getDb()
      .run(
        'INSERT INTO sessions (id, project, project_path, started_at) VALUES (?, ?, ?, ?)',
        [input.id, input.project, input.project_path ?? null, input.started_at]
      )
    this.db.persist()
  }

  getById(id: string): Session | undefined {
    const result = this.db.getDb().exec('SELECT * FROM sessions WHERE id = ?', [id])
    if (!result[0]?.values[0]) return undefined
    return this.mapRow(result[0].columns, result[0].values[0])
  }

  update(id: string, input: UpdateSessionInput): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (input.ended_at !== undefined) {
      sets.push('ended_at = ?')
      values.push(input.ended_at)
    }
    if (input.summary !== undefined) {
      sets.push('summary = ?')
      values.push(input.summary)
    }
    if (input.discovery_tokens !== undefined) {
      sets.push('discovery_tokens = ?')
      values.push(input.discovery_tokens)
    }
    if (sets.length === 0) return
    values.push(id)
    this.db.getDb().run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, values as import('sql.js').SqlValue[])
    this.db.persist()
  }

  getLatestByProject(project: string): Session | undefined {
    const result = this.db.getDb().exec(
      'SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT 1',
      [project]
    )
    if (!result[0]?.values[0]) return undefined
    return this.mapRow(result[0].columns, result[0].values[0])
  }

  private mapRow(columns: string[], values: unknown[]): Session {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = values[i]
    })
    return obj as unknown as Session
  }
}
