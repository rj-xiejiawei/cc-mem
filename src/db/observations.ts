import type { Database } from './database.js'
import { contentHash } from '../utils/hash.js'

export interface Observation {
  id: string
  session_id: string
  type: string
  title: string
  narrative: string | null
  facts: string | null
  concepts: string | null
  files_read: string | null
  files_modified: string | null
  project: string
  content_hash: string | null
  prompt_number: number | null
  status: string
  reviewed_at: string | null
  created_at: string
  discovery_tokens: number
}

interface CreateObservationInput {
  id: string
  session_id: string
  type: string
  title: string
  narrative?: string
  facts?: string
  concepts?: string
  files_read?: string
  files_modified?: string
  project: string
  prompt_number?: number
  status?: string
  created_at: string
  discovery_tokens?: number
}

export class ObservationsRepo {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateObservationInput): 'created' | 'duplicate' {
    const hash = input.narrative ? contentHash(input.title, input.narrative) : null

    if (hash) {
      const cutoff = new Date(Date.now() - 30_000).toISOString()
      const dup = this.db.getDb().exec(
        'SELECT id FROM observations WHERE content_hash = ? AND session_id = ? AND created_at > ?',
        [hash, input.session_id, cutoff]
      )
      if (dup[0]?.values.length) return 'duplicate'
    }

    this.db.getDb().run(
      `INSERT INTO observations (id, session_id, type, title, narrative, facts, concepts,
        files_read, files_modified, project, content_hash, prompt_number, status, created_at, discovery_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.session_id,
        input.type,
        input.title,
        input.narrative ?? null,
        input.facts ?? null,
        input.concepts ?? null,
        input.files_read ?? null,
        input.files_modified ?? null,
        input.project,
        hash,
        input.prompt_number ?? null,
        input.status ?? 'confirmed',
        input.created_at,
        input.discovery_tokens ?? 0,
      ]
    )
    this.db.persist()
    return 'created'
  }

  getById(id: string): Observation | undefined {
    const result = this.db.getDb().exec('SELECT * FROM observations WHERE id = ?', [id])
    if (!result[0]?.values[0]) return undefined
    return this.mapRow(result[0].columns, result[0].values[0])
  }

  listByProject(project: string, limit: number): Observation[] {
    const result = this.db.getDb().exec(
      'SELECT * FROM observations WHERE project = ? ORDER BY created_at DESC LIMIT ?',
      [project, limit]
    )
    if (!result[0]) return []
    return result[0].values.map((row: unknown[]) => this.mapRow(result[0].columns, row))
  }

  listBySession(sessionId: string): Observation[] {
    const result = this.db.getDb().exec(
      'SELECT * FROM observations WHERE session_id = ? ORDER BY created_at',
      [sessionId]
    )
    if (!result[0]) return []
    return result[0].values.map((row: unknown[]) => this.mapRow(result[0].columns, row))
  }

  updateStatus(id: string, status: string): void {
    this.db
      .getDb()
      .run('UPDATE observations SET status = ?, reviewed_at = ? WHERE id = ?', [
        status,
        new Date().toISOString(),
        id,
      ])
    this.db.persist()
  }

  delete(id: string): void {
    this.db.getDb().run('DELETE FROM observations WHERE id = ?', [id])
    this.db.persist()
  }

  listProjects(): { project: string; count: number; last_activity: string }[] {
    const result = this.db.getDb().exec(
      'SELECT project, COUNT(*) as count, MAX(created_at) as last_activity FROM observations GROUP BY project ORDER BY last_activity DESC'
    )
    if (!result[0]) return []
    return result[0].values.map((row: unknown[]) => ({
      project: row[0] as string,
      count: row[1] as number,
      last_activity: row[2] as string,
    }))
  }

  private mapRow(columns: string[], values: unknown[]): Observation {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = values[i]
    })
    return obj as unknown as Observation
  }
}
