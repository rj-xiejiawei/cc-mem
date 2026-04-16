import { z } from 'zod'
import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'
import { SessionsRepo } from '../db/sessions.js'
import { formatContext } from '../utils/format.js'
import { detectProject } from '../utils/project.js'

export const getContextSchema = z.object({
  project: z.string().optional(),
  limit: z.number().optional(),
})

export function getContext(
  db: Database,
  input: z.infer<typeof getContextSchema>,
  cwd: string
) {
  const project = detectProject(cwd, input.project)
  const obs = new ObservationsRepo(db)
  const sessions = new SessionsRepo(db)

  const observations = obs.listByProject(project, input.limit || 20)
  const lastSession = sessions.getLatestByProject(project)

  const formatted = formatContext(observations, project, 0)
  const summary = lastSession?.summary
    ? `\n\nLast session summary:\n${lastSession.summary}`
    : ''

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          observations: observations.map((o) => ({
            id: o.id,
            type: o.type,
            title: o.title,
            narrative: o.narrative,
            created_at: o.created_at,
          })),
          last_summary: lastSession?.summary
            ? JSON.parse(lastSession.summary)
            : null,
          formatted_context: formatted + summary,
        }),
      },
    ],
  }
}
