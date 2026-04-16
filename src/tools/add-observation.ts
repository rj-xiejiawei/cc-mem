import { z } from 'zod'
import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'
import { SessionsRepo } from '../db/sessions.js'
import type { LLMProvider } from '../llm/provider.js'
import { detectProject } from '../utils/project.js'
import { v7 as uuidv7 } from 'uuid'

const VALID_TYPES = ['bugfix', 'feature', 'refactor', 'change', 'discovery', 'decision']

export const addObservationSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  narrative: z.string().optional(),
  facts: z.array(z.string()).optional(),
  concepts: z.array(z.string()).optional(),
  files_read: z.array(z.string()).optional(),
  files_modified: z.array(z.string()).optional(),
  raw_context: z.string().optional(),
  project: z.string().optional(),
  status: z.string().optional(),
})

export async function addObservation(
  db: Database,
  llm: LLMProvider,
  input: z.infer<typeof addObservationSchema>,
  cwd: string
) {
  const obs = new ObservationsRepo(db)
  const sessions = new SessionsRepo(db)
  const project = detectProject(cwd, input.project)

  // Ensure a session exists
  const latest = sessions.getLatestByProject(project)
  let sessionId: string
  if (latest && !latest.ended_at) {
    sessionId = latest.id
  } else {
    sessionId = uuidv7()
    sessions.create({
      id: sessionId,
      project,
      project_path: cwd,
      started_at: new Date().toISOString(),
    })
  }

  // If raw_context, use LLM to extract
  if (input.raw_context) {
    try {
      const extracted = await llm.extractObservation(input.raw_context)
      if ('skip' in extracted) {
        return { content: [{ type: 'text' as const, text: 'No significant observation to record.' }] }
      }
      const id = uuidv7()
      const result = obs.create({
        id,
        session_id: sessionId,
        type: extracted.type,
        title: extracted.title,
        narrative: extracted.narrative,
        facts: JSON.stringify(extracted.facts),
        concepts: JSON.stringify(extracted.concepts),
        files_read: JSON.stringify(extracted.files_read),
        files_modified: JSON.stringify(extracted.files_modified),
        project,
        created_at: new Date().toISOString(),
      })
      if (result === 'duplicate') {
        return { content: [{ type: 'text' as const, text: 'Duplicate observation, skipped.' }] }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, type: extracted.type, title: extracted.title }) }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `LLM extraction failed: ${(e as Error).message}. Provide structured fields directly.` }] }
    }
  }

  // Structured input
  if (!input.title) {
    return { content: [{ type: 'text' as const, text: 'Error: title is required when raw_context is not provided.' }] }
  }
  const type = input.type || 'change'
  if (!VALID_TYPES.includes(type)) {
    return { content: [{ type: 'text' as const, text: `Error: invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}` }] }
  }

  const id = uuidv7()
  const result = obs.create({
    id,
    session_id: sessionId,
    type,
    title: input.title,
    narrative: input.narrative,
    facts: input.facts ? JSON.stringify(input.facts) : undefined,
    concepts: input.concepts ? JSON.stringify(input.concepts) : undefined,
    files_read: input.files_read ? JSON.stringify(input.files_read) : undefined,
    files_modified: input.files_modified ? JSON.stringify(input.files_modified) : undefined,
    project,
    status: input.status,
    created_at: new Date().toISOString(),
  })

  if (result === 'duplicate') {
    return { content: [{ type: 'text' as const, text: 'Duplicate observation, skipped.' }] }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify({ id, type, title: input.title }) }] }
}
