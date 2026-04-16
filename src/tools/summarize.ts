import { z } from 'zod'
import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'
import { SessionsRepo } from '../db/sessions.js'
import type { LLMProvider } from '../llm/provider.js'

export const summarizeSchema = z.object({
  session_id: z.string(),
})

export async function summarize(
  db: Database,
  llm: LLMProvider,
  input: z.infer<typeof summarizeSchema>
) {
  const obs = new ObservationsRepo(db)
  const sessions = new SessionsRepo(db)

  const observations = obs.listBySession(input.session_id)
  if (observations.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No observations to summarize.' },
      ],
    }
  }

  const observationsText = observations
    .map(
      (o) =>
        `[${o.type}] ${o.title}: ${o.narrative || ''}`
    )
    .join('\n')

  try {
    const summary = await llm.summarizeSession(observationsText)
    const summaryJson = JSON.stringify(summary)
    sessions.update(input.session_id, {
      ended_at: new Date().toISOString(),
      summary: summaryJson,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(summary) }],
    }
  } catch (e) {
    // Still mark session as ended even if summarization fails
    sessions.update(input.session_id, {
      ended_at: new Date().toISOString(),
    })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Summarization failed: ${(e as Error).message}`,
        },
      ],
    }
  }
}
