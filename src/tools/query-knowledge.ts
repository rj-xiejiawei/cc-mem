import { z } from 'zod'
import type { Database } from '../db/database.js'
import { KnowledgeRepo } from '../db/knowledge.js'

export const queryKnowledgeSchema = z.object({
  project: z.string().optional(),
  kind: z.string().optional(),
  entity: z.string().optional(),
  query: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().optional(),
})

export function queryKnowledge(
  db: Database,
  input: z.infer<typeof queryKnowledgeSchema>
) {
  const knowledgeRepo = new KnowledgeRepo(db)
  const { project, kind, entity, query, status, limit } = input

  if (query) {
    // Search with LIKE (FTS5 search on knowledge not exposed via separate repo)
    const searchResults = searchKnowledge(db, query, {
      project,
      kind,
      entity,
      status,
      limit: limit ?? 20,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(searchResults) }],
    }
  }

  if (!project) {
    return {
      content: [{ type: 'text' as const, text: 'Error: project or query parameter is required.' }],
    }
  }

  const results = knowledgeRepo.listByProject(project, {
    kind,
    entity,
    status,
    limit,
  })

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(results) }],
  }
}

interface SearchOptions {
  project?: string
  kind?: string
  entity?: string
  status?: string
  limit: number
}

function searchKnowledge(
  db: Database,
  query: string,
  options: SearchOptions
) {
  const { project, kind, entity, status, limit } = options
  const likeQuery = `%${query}%`

  let sql = `SELECT * FROM knowledge WHERE (summary LIKE ? OR detail LIKE ? OR kind LIKE ? OR entity LIKE ?)`
  const params: (string | number)[] = [likeQuery, likeQuery, likeQuery, likeQuery]

  if (project) { sql += ' AND project = ?'; params.push(project) }
  if (kind) { sql += ' AND kind = ?'; params.push(kind) }
  if (entity) { sql += ' AND entity = ?'; params.push(entity) }
  if (status) { sql += ' AND status = ?'; params.push(status) }

  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const result = db.getDb().exec(sql, params)
  if (!result[0]) return []

  return result[0].values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    result[0].columns.forEach((col: string, i: number) => {
      obj[col] = row[i]
    })
    return obj
  })
}
