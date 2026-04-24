import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from './db/database.js'
import type { LLMProvider } from './llm/provider.js'
import { addObservation, addObservationSchema } from './tools/add-observation.js'
import { search, searchSchema } from './tools/search.js'
import { getContext, getContextSchema } from './tools/get-context.js'
import { summarize, summarizeSchema } from './tools/summarize.js'
import { reviewObservation, reviewObservationSchema } from './tools/review-observation.js'
import { listProjects } from './tools/list-projects.js'
import { deleteObservation, deleteObservationSchema } from './tools/delete-observation.js'
import { extractKnowledge, extractKnowledgeSchema } from './tools/extract-knowledge.js'
import { queryKnowledge, queryKnowledgeSchema } from './tools/query-knowledge.js'
import { deprecateKnowledge, deprecateKnowledgeSchema } from './tools/deprecate-knowledge.js'
import { helloWorld, helloWorldSchema } from './tools/hello-world.js'
import { USAGE_GUIDE } from './prompts/usage-guide.js'

interface CreateServerInput {
  db: Database
  llm: LLMProvider
}

export function createServer({ db, llm }: CreateServerInput): McpServer {
  const server = new McpServer({
    name: 'cc-mem',
    version: '0.2.0',
  })

  const cwd = process.cwd()

  // Tools
  server.tool(
    'add_observation',
    'Add an observation to memory. Pass raw_context for LLM extraction, or structured fields directly.',
    addObservationSchema.shape,
    async (input) => addObservation(db, llm, input, cwd)
  )

  server.tool(
    'search',
    'Search memories by keyword using full-text search.',
    searchSchema.shape,
    async (input) => search(db, input)
  )

  server.tool(
    'get_context',
    'Get recent observations and last session summary for a project.',
    getContextSchema.shape,
    async (input) => getContext(db, input, cwd)
  )

  server.tool(
    'summarize',
    'Generate a session summary using LLM.',
    summarizeSchema.shape,
    async (input) => summarize(db, llm, input)
  )

  server.tool(
    'review_observation',
    'Review a pending observation: confirm, reject (delete), deprecate, or promote to knowledge.',
    reviewObservationSchema.shape,
    async (input) => reviewObservation(db, llm, input)
  )

  server.tool(
    'list_projects',
    'List all projects that have stored memories.',
    {},
    async () => listProjects(db)
  )

  server.tool(
    'hello_world',
    'Say hello! A simple greeting tool to verify cc-mem is working.',
    helloWorldSchema.shape,
    async (input) => helloWorld(input)
  )

  server.tool(
    'delete_observation',
    'Delete an observation by ID.',
    deleteObservationSchema.shape,
    async (input) => deleteObservation(db, input)
  )

  server.tool(
    'extract_knowledge',
    'Extract knowledge from an observation using LLM with semantic dedup.',
    extractKnowledgeSchema.shape,
    async (input) => extractKnowledge(db, llm, input)
  )

  server.tool(
    'query_knowledge',
    'Query or search the knowledge base by project, kind, entity, or keyword.',
    queryKnowledgeSchema.shape,
    async (input) => queryKnowledge(db, input)
  )

  server.tool(
    'deprecate_knowledge',
    'Mark a knowledge entry as deprecated.',
    deprecateKnowledgeSchema.shape,
    async (input) => deprecateKnowledge(db, input)
  )

  // Resources
  server.resource(
    'cc-mem://context/{project}',
    'Project context — recent observations and last session summary',
    async (uri) => {
      const { ObservationsRepo } = await import('./db/observations.js')
      const { SessionsRepo } = await import('./db/sessions.js')
      const { formatContext } = await import('./utils/format.js')
      const project = decodeURIComponent(uri.pathname.replace(/^\//, ''))
      const obs = new ObservationsRepo(db)
      const sessions = new SessionsRepo(db)
      const observations = obs.listByProject(project, 20)
      const lastSession = sessions.getLatestByProject(project)
      let output = formatContext(observations, project, 0)
      if (lastSession?.summary) {
        output += '\n\n---\n\nLast session summary:\n' + lastSession.summary
      }
      return { contents: [{ uri: uri.toString(), text: output }] }
    }
  )

  server.resource(
    'cc-mem://knowledge/{project}',
    'Active knowledge for a project, grouped by kind',
    async (uri) => {
      const { KnowledgeRepo } = await import('./db/knowledge.js')
      const project = decodeURIComponent(uri.pathname.replace(/^\//, ''))
      const knowledgeRepo = new KnowledgeRepo(db)
      const entries = knowledgeRepo.listByProject(project, { status: 'active' })

      if (entries.length === 0) {
        return {
          contents: [{
            uri: uri.toString(),
            text: `[cc-mem] No active knowledge for ${project}`,
          }],
        }
      }

      // Group by kind
      const grouped: Record<string, typeof entries> = {}
      for (const entry of entries) {
        if (!grouped[entry.kind]) grouped[entry.kind] = []
        grouped[entry.kind].push(entry)
      }

      const kindLabels: Record<string, string> = {
        rule: 'Rules',
        adr: 'ADR',
        constraint: 'Constraints',
        procedure: 'Procedures',
        pattern: 'Patterns',
      }

      let output = `[cc-mem] Knowledge for ${project} (${entries.length} entries)\n\n`
      for (const [kind, items] of Object.entries(grouped)) {
        output += `## ${kindLabels[kind] || kind}\n`
        for (const item of items) {
          output += `• ${item.entity}: ${item.summary}\n`
        }
        output += '\n'
      }

      return { contents: [{ uri: uri.toString(), text: output.trimEnd() }] }
    }
  )

  // Prompts
  server.prompt(
    'usage-guide',
    'How to use cc-mem memory tools',
    {},
    async () => ({
      messages: [
        { role: 'assistant', content: { type: 'text', text: USAGE_GUIDE } },
      ],
    })
  )

  return server
}
