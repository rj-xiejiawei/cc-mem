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
  private fts5Available: boolean | null = null

  constructor(db: Database) {
    this.db = db
  }

  private isFts5Available(): boolean {
    if (this.fts5Available !== null) return this.fts5Available
    try {
      const result = this.db.getDb().exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'"
      )
      this.fts5Available = result[0]?.values.length > 0
    } catch {
      this.fts5Available = false
    }
    return this.fts5Available
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const { limit = 10, type, project, status, since } = options

    let sql: string
    const params: (string | number)[] = []

    if (this.isFts5Available()) {
      sql = `
        SELECT o.*, fts.rank
        FROM observations_fts fts
        JOIN observations o ON o.rowid = fts.rowid
        WHERE observations_fts MATCH ?
      `
      params.push(query)
    } else {
      sql = `
        SELECT o.*, 0 AS rank
        FROM observations o
        WHERE (o.title LIKE ? OR o.narrative LIKE ? OR o.facts LIKE ? OR o.concepts LIKE ?)
      `
      const likeQuery = `%${query}%`
      params.push(likeQuery, likeQuery, likeQuery, likeQuery)
    }

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

    sql += ' ORDER BY rank LIMIT ?'
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
