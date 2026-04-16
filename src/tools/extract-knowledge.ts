import { z } from 'zod'
import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'
import { KnowledgeRepo } from '../db/knowledge.js'
import type { LLMProvider } from '../llm/provider.js'
import { v7 as uuidv7 } from 'uuid'

export const extractKnowledgeSchema = z.object({
  observation_id: z.string(),
})

export async function extractKnowledge(
  db: Database,
  llm: LLMProvider,
  input: z.infer<typeof extractKnowledgeSchema>
) {
  const obs = new ObservationsRepo(db)
  const knowledgeRepo = new KnowledgeRepo(db)

  const observation = obs.getById(input.observation_id)
  if (!observation) {
    return {
      content: [{ type: 'text' as const, text: `Error: Observation ${input.observation_id} not found.` }],
    }
  }

  // Get existing knowledge for dedup context
  const existingKnowledge = knowledgeRepo.listByProject(observation.project, {
    status: 'active',
  })

  try {
    const result = await llm.extractKnowledge(observation, existingKnowledge)

    if (result.action === 'skip') {
      return {
        content: [{ type: 'text' as const, text: `Skipped: ${result.reason}` }],
      }
    }

    if (result.action === 'duplicate') {
      return {
        content: [{ type: 'text' as const, text: `Duplicate of existing knowledge: ${result.existing_id}` }],
      }
    }

    // action === 'create'
    const id = uuidv7()
    knowledgeRepo.create({
      id,
      kind: result.kind,
      entity: result.entity,
      summary: result.summary,
      detail: result.detail,
      source_observation_id: input.observation_id,
      project: observation.project,
      created_at: new Date().toISOString(),
    })

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          id,
          kind: result.kind,
          entity: result.entity,
          summary: result.summary,
        }),
      }],
    }
  } catch (e) {
    return {
      content: [{
        type: 'text' as const,
        text: `Knowledge extraction failed: ${(e as Error).message}`,
      }],
    }
  }
}
