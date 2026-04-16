import { z } from 'zod'
import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'
import { KnowledgeRepo } from '../db/knowledge.js'
import type { LLMProvider } from '../llm/provider.js'
import { v7 as uuidv7 } from 'uuid'

export const reviewObservationSchema = z.object({
  id: z.string(),
  action: z.enum(['confirm', 'reject', 'deprecate', 'promote']),
  kind: z.string().optional(),
  entity: z.string().optional(),
})

export async function reviewObservation(
  db: Database,
  llm: LLMProvider,
  input: z.infer<typeof reviewObservationSchema>
) {
  const obs = new ObservationsRepo(db)
  const knowledgeRepo = new KnowledgeRepo(db)

  if (input.action === 'reject') {
    obs.delete(input.id)
    return {
      content: [
        { type: 'text' as const, text: `Observation ${input.id} rejected and deleted.` },
      ],
    }
  }

  if (input.action === 'promote') {
    const observation = obs.getById(input.id)
    if (!observation) {
      return {
        content: [{ type: 'text' as const, text: `Error: Observation ${input.id} not found.` }],
      }
    }

    // Idempotency: if already promoted, return existing knowledge
    if (observation.status === 'promoted') {
      const existingKnowledge = knowledgeRepo.listBySourceObservation(input.id)
      if (existingKnowledge.length > 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(existingKnowledge.map((k) => ({
              id: k.id,
              kind: k.kind,
              entity: k.entity,
              summary: k.summary,
            }))),
          }],
        }
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
          content: [{ type: 'text' as const, text: `Promotion skipped: ${result.reason}` }],
        }
      }

      if (result.action === 'duplicate') {
        return {
          content: [{ type: 'text' as const, text: `Duplicate of existing knowledge: ${result.existing_id}` }],
        }
      }

      // action === 'create'
      const knowledgeId = uuidv7()
      knowledgeRepo.create({
        id: knowledgeId,
        kind: result.kind,
        entity: result.entity,
        summary: result.summary,
        detail: result.detail,
        source_observation_id: input.id,
        project: observation.project,
        created_at: new Date().toISOString(),
      })

      obs.updateStatus(input.id, 'promoted')

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: knowledgeId,
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

  // confirm or deprecate
  obs.updateStatus(input.id, input.action === 'confirm' ? 'confirmed' : 'deprecated')
  return {
    content: [
      { type: 'text' as const, text: `Observation ${input.id} marked as ${input.action === 'confirm' ? 'confirmed' : 'deprecated'}.` },
    ],
  }
}
