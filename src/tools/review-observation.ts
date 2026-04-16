import { z } from 'zod'
import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'

export const reviewObservationSchema = z.object({
  id: z.string(),
  action: z.enum(['confirm', 'reject', 'deprecate']),
})

export function reviewObservation(
  db: Database,
  input: z.infer<typeof reviewObservationSchema>
) {
  const obs = new ObservationsRepo(db)

  if (input.action === 'reject') {
    obs.delete(input.id)
    return {
      content: [
        { type: 'text' as const, text: `Observation ${input.id} rejected and deleted.` },
      ],
    }
  }

  obs.updateStatus(input.id, input.action === 'confirm' ? 'confirmed' : 'deprecated')
  return {
    content: [
      { type: 'text' as const, text: `Observation ${input.id} marked as ${input.action === 'confirm' ? 'confirmed' : 'deprecated'}.` },
    ],
  }
}
