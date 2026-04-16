import type { Database } from '../db/database.js'
import { ObservationsRepo } from '../db/observations.js'
import { SessionsRepo } from '../db/sessions.js'
import { formatContext } from '../utils/format.js'

export function createContextResource(db: Database) {
  return {
    uri: 'cc-mem://context/{project}',
    name: 'Project context',
    description:
      'Recent observations and last session summary for a project',
    mimeType: 'text/markdown',
    async handler(uri: URL) {
      const project = decodeURIComponent(
        uri.pathname.replace(/^\//, '')
      )
      const obs = new ObservationsRepo(db)
      const sessions = new SessionsRepo(db)

      const observations = obs.listByProject(project, 20)
      const lastSession = sessions.getLatestByProject(project)

      let output = formatContext(observations, project, 0)

      if (lastSession?.summary) {
        output += '\n\n---\n\nLast session summary:\n' + lastSession.summary
      }

      return { contents: [{ uri: uri.toString(), text: output }] }
    },
  }
}
