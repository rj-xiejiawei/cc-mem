import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'

export function listProjects(db: Database) {
  const obs = new ObservationsRepo(db)
  const projects = obs.listProjects()
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(projects) }],
  }
}
