import type { Database } from './database.js'
import type { Observation } from './observations.js'

interface SearchOptions {
  limit?: number
  type?: string
  project?: string
  status?: string
  since?: string
}

export interface SearchResult extends Observation {
  rank: number
}

export class SearchRepo {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const { limit = 10, type, project, status, since } = options

    let sql = `
      SELECT o.*, fts.rank
      FROM observations_fts fts
      JOIN observations o ON o.rowid = fts.rowid
      WHERE observations_fts MATCH ?
    `
    const params: (string | number)[] = [query]

    if (project) {
      sql += ' AND o.project = ?'
      params.push(project)
    }
    if (type) {
      sql += ' AND o.type = ?'
      params.push(type)
    }
    if (status) {
      sql += ' AND o.status = ?'
      params.push(status)
    }
    if (since) {
      sql += ' AND o.created_at > ?'
      params.push(since)
    }

    sql += ' ORDER BY fts.rank LIMIT ?'
    params.push(limit)

    const result = this.db.getDb().exec(sql, params)
    if (!result[0]) return []

    return result[0].values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {}
      result[0].columns.forEach((col: string, i: number) => {
        obj[col] = row[i]
      })
      return obj as unknown as SearchResult
    })
  }
}
