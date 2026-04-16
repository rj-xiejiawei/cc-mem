import type { Database } from './database.js'
import type { Knowledge } from '../llm/provider.js'

interface CreateKnowledgeInput {
  id: string
  kind: string
  entity: string
  summary: string
  detail?: string
  source_observation_id?: string
  project: string
  created_at: string
}

interface ListOptions {
  kind?: string
  entity?: string
  status?: string
  limit?: number
}

export class KnowledgeRepo {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateKnowledgeInput): void {
    this.db.getDb().run(
      `INSERT INTO knowledge (id, kind, entity, summary, detail, source_observation_id, status, project, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.id,
        input.kind,
        input.entity,
        input.summary,
        input.detail ?? null,
        input.source_observation_id ?? null,
        input.project,
        input.created_at,
      ]
    )
    this.db.persist()
  }

  getById(id: string): Knowledge | undefined {
    const result = this.db.getDb().exec('SELECT * FROM knowledge WHERE id = ?', [id])
    if (!result[0]?.values[0]) return undefined
    return this.mapRow(result[0].columns, result[0].values[0])
  }

  listByProject(project: string, options: ListOptions = {}): Knowledge[] {
    const { kind, entity, status, limit = 100 } = options
    let sql = 'SELECT * FROM knowledge WHERE project = ?'
    const params: (string | number)[] = [project]

    if (kind) { sql += ' AND kind = ?'; params.push(kind) }
    if (entity) { sql += ' AND entity = ?'; params.push(entity) }
    if (status) { sql += ' AND status = ?'; params.push(status) }

    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const result = this.db.getDb().exec(sql, params)
    if (!result[0]) return []
    return result[0].values.map((row: unknown[]) => this.mapRow(result[0].columns, row))
  }

  listBySourceObservation(observationId: string): Knowledge[] {
    const result = this.db.getDb().exec(
      'SELECT * FROM knowledge WHERE source_observation_id = ?',
      [observationId]
    )
    if (!result[0]) return []
    return result[0].values.map((row: unknown[]) => this.mapRow(result[0].columns, row))
  }

  updateStatus(id: string, status: 'active' | 'deprecated'): void {
    this.db.getDb().run('UPDATE knowledge SET status = ? WHERE id = ?', [status, id])
    this.db.persist()
  }

  delete(id: string): void {
    this.db.getDb().run('DELETE FROM knowledge WHERE id = ?', [id])
    this.db.persist()
  }

  private mapRow(columns: string[], values: unknown[]): Knowledge {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col] = values[i] })
    return obj as unknown as Knowledge
  }
}
