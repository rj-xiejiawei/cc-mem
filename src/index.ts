#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Database } from './db/database.js'
import { createServer } from './server.js'
import { ZhipuProvider } from './llm/providers/zhipu.js'
import { OpenAICompatibleProvider } from './llm/providers/openai-compatible.js'
import type { LLMProvider } from './llm/provider.js'
import path from 'node:path'
import os from 'node:os'

async function main() {
  const dbPath =
    process.env.CC_MEM_DB_PATH ||
    path.join(os.homedir(), '.cc-mem', 'memories.db')

  const db = new Database(dbPath)
  await db.init()

  const providerName = process.env.CC_MEM_LLM_PROVIDER || 'zhipu'
  let llm: LLMProvider

  if (providerName === 'zhipu') {
    const apiKey = process.env.CC_MEM_ZHIPU_API_KEY || ''
    const model = process.env.CC_MEM_ZHIPU_MODEL || 'glm-4-flash'
    llm = new ZhipuProvider({ apiKey, model })
  } else {
    const baseURL = process.env.CC_MEM_LLM_BASE_URL
    if (!baseURL) {
      console.error('CC_MEM_LLM_BASE_URL is required for openai-compatible provider')
      process.exit(1)
    }
    llm = new OpenAICompatibleProvider({
      baseURL,
      apiKey: process.env.CC_MEM_LLM_API_KEY || '',
      model: process.env.CC_MEM_LLM_MODEL || 'gpt-4o',
    })
  }

  const server = createServer({ db, llm })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('cc-mem fatal:', err)
  process.exit(1)
})
