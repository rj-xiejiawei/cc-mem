import { z } from 'zod'
import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'

export const deleteObservationSchema = z.object({
  id: z.string(),
})

export function deleteObservation(
  db: Database,
  input: z.infer<typeof deleteObservationSchema>
) {
  const obs = new ObservationsRepo(db)
  obs.delete(input.id)
  return {
    content: [
      { type: 'text' as const, text: `Observation ${input.id} deleted.` },
    ],
  }
}
