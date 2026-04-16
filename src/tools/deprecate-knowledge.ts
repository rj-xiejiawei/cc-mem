import { z } from 'zod'
import type { Database } from '../db/database.js'
import { KnowledgeRepo } from '../db/knowledge.js'

export const deprecateKnowledgeSchema = z.object({
  knowledge_id: z.string(),
})

export function deprecateKnowledge(
  db: Database,
  input: z.infer<typeof deprecateKnowledgeSchema>
) {
  const knowledgeRepo = new KnowledgeRepo(db)

  const existing = knowledgeRepo.getById(input.knowledge_id)
  if (!existing) {
    return {
      content: [{ type: 'text' as const, text: `Error: Knowledge ${input.knowledge_id} not found.` }],
    }
  }

  if (existing.status === 'deprecated') {
    return {
      content: [{ type: 'text' as const, text: `Knowledge ${input.knowledge_id} is already deprecated.` }],
    }
  }

  knowledgeRepo.updateStatus(input.knowledge_id, 'deprecated')
  return {
    content: [{ type: 'text' as const, text: `Knowledge ${input.knowledge_id} deprecated.` }],
  }
}
