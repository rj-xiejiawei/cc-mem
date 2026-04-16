import { z } from 'zod'
import type { Database } from '../db/database.js'
import { SearchRepo } from '../db/search.js'

export const searchSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
  type: z.string().optional(),
  project: z.string().optional(),
  status: z.string().optional(),
  since: z.string().optional(),
})

export function search(db: Database, input: z.infer<typeof searchSchema>) {
  const repo = new SearchRepo(db)
  const results = repo.search(input.query, {
    limit: input.limit,
    type: input.type,
    project: input.project,
    status: input.status,
    since: input.since,
  })
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ results }) },
    ],
  }
}
