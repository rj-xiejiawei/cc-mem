#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Database } from './db/database.js'
import { createServer } from './server.js'
import { ZhipuProvider } from './llm/providers/zhipu.js'
import path from 'node:path'
import os from 'node:os'

async function main() {
  const dbPath =
    process.env.CC_MEM_DB_PATH ||
    path.join(os.homedir(), '.cc-mem', 'memories.db')

  const db = new Database(dbPath)
  await db.init()

  const apiKey = process.env.CC_MEM_ZHIPU_API_KEY || ''
  const model = process.env.CC_MEM_ZHIPU_MODEL || 'glm-4-flash'
  const llm = new ZhipuProvider({ apiKey, model })

  const server = createServer({ db, llm })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('cc-mem fatal:', err)
  process.exit(1)
})
