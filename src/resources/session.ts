import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'
import { SessionsRepo } from '../db/sessions.js'

export function createSessionResource(db: Database) {
  return {
    uri: 'cc-mem://session/{session_id}',
    name: 'Session record',
    description: 'Full session details with all observations',
    mimeType: 'application/json',
    async handler(uri: URL) {
      const sessionId = decodeURIComponent(
        uri.pathname.replace(/^\//, '')
      )
      const sessions = new SessionsRepo(db)
      const obs = new ObservationsRepo(db)

      const session = sessions.getById(sessionId)
      if (!session) {
        return {
          contents: [
            { uri: uri.toString(), text: JSON.stringify({ error: 'not found' }) },
          ],
        }
      }

      const observations = obs.listBySession(sessionId)
      return {
        contents: [
          {
            uri: uri.toString(),
            text: JSON.stringify({ session, observations }, null, 2),
          },
        ],
      }
    },
  }
}
