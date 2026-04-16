# cc-mem Phase 2 — Knowledge Layer Design Spec

**Date**: 2026-04-17
**Status**: Draft
**Depends on**: Phase 1 (complete)

## 1. Overview

Phase 2 adds a structured knowledge layer on top of Phase 1's observation memory. Observations capture what happened; knowledge captures what was learned and what matters long-term.

**Approach**: Manual/on-demand knowledge extraction (Plan A) — user or AI triggers extraction from observations. LLM deduplicates against existing knowledge before writing.

**Scope**:
- Knowledge table + CRUD
- Knowledge extraction tool (LLM-powered, with dedup)
- Knowledge promotion via review_observation enhancement
- Multiple LLM providers (OpenAI-compatible, DeepSeek, Anthropic, Ollama)
- Enhanced concepts extraction (broader synonyms for FTS5 semantic coverage)

**Out of scope** (deferred):
- Vector index — FTS5 + broad concepts covers semantic gaps
- Claude Code plugin adapter — MCP Resources already solve auto-injection
- Automatic knowledge extraction — LLM lacks context to judge correctly at observation time

## 2. Knowledge Table

### Migration v2

```sql
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,           -- rule | adr | constraint | procedure | pattern
  entity TEXT NOT NULL,         -- Module/domain, e.g. 'auth', 'payment'
  summary TEXT NOT NULL,        -- One-line summary
  detail TEXT,                  -- Detailed description (optional)
  source_observation_id TEXT REFERENCES observations(id),
  status TEXT NOT NULL DEFAULT 'active',  -- active | deprecated
  project TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_knowledge_kind ON knowledge(kind);
CREATE INDEX idx_knowledge_entity ON knowledge(entity);
CREATE INDEX idx_knowledge_project ON knowledge(project);
CREATE INDEX idx_knowledge_status ON knowledge(status);
```

### Knowledge Kinds

| kind | Meaning | Example |
|------|---------|---------|
| `rule` | Project convention | "All API responses use { code, data, message }" |
| `adr` | Architecture Decision Record | "Use sql.js over better-sqlite3 for zero native deps" |
| `constraint` | Constraint/limitation | "Max concurrent connections: 100" |
| `procedure` | Operational procedure | "Deploy: build → test → publish" |
| `pattern` | Code pattern | "Error handling: try/catch + logger.error" |

### KnowledgeRepo

```typescript
class KnowledgeRepo {
  create(input: CreateKnowledgeInput): 'created' | 'duplicate'
  getById(id: string): Knowledge | undefined
  listByProject(project: string, options?: { kind?, entity?, status?, limit? }): Knowledge[]
  updateStatus(id: string, status: 'active' | 'deprecated'): void
  delete(id: string): void
  searchByEntity(project: string, entity: string): Knowledge[]
}
```

Dedup: check `kind + entity + summary` hash within the same project.

## 3. Knowledge Extraction Tool

### New MCP Tool: `extract_knowledge`

```typescript
extract_knowledge({
  observation_id: string  // The observation to extract from
})
```

**Flow:**
1. Read the observation by ID
2. Query existing knowledge for the same project (for dedup context)
3. Send to LLM with extraction prompt:
   - Present existing knowledge list (dedup)
   - 5 kind categories with definitions
   - Entity extraction guidance (module/domain granularity)
   - Summary: one sentence; Detail: optional expansion
4. LLM returns one of:
   - `{kind, entity, summary, detail}` → write to knowledge table
   - `{skip: true, reason}` → not worth extracting
   - `{already_exists: knowledge_id}` → duplicate found
5. Return result to caller

**Extraction prompt structure:**
```
System: You are a knowledge extractor. Given an observation and existing knowledge,
determine if this observation contains reusable knowledge worth preserving.

Rules:
1. Only extract knowledge with lasting value (rules, decisions, constraints, procedures, patterns)
2. Skip: one-off facts, temporary states, status updates
3. kind must be: rule | adr | constraint | procedure | pattern
4. entity: the module/domain this knowledge applies to (e.g. 'auth', 'payment', 'api')
5. summary: one sentence, imperative form
6. detail: optional, 2-3 sentences explaining why and how
7. Check existing knowledge — if similar already exists, return {already_exists: id}

Existing knowledge for this project:
{existing_knowledge_list}

Observation:
{observation_content}

Output JSON:
{"action":"create","kind":"...","entity":"...","summary":"...","detail":"..."}
{"action":"skip","reason":"..."}
{"action":"duplicate","existing_id":"..."}
```

## 4. Promotion Workflow

### Enhanced `review_observation` Tool

Add `promote` action:

```typescript
review_observation({
  observation_id: string,
  action: 'confirm' | 'reject' | 'deprecate' | 'promote',  // new: promote
  kind?: string,        // Required for promote
  entity?: string       // Required for promote
})
```

**Promote flow:**
1. Read observation content
2. Use LLM to transform observation into knowledge format
3. Write to knowledge table with `source_observation_id`
4. Mark observation status as `promoted`

### New MCP Tool: `query_knowledge`

```typescript
query_knowledge({
  project?: string,
  kind?: string,
  entity?: string,
  status?: string,      // active | deprecated
  limit?: number
})
```

Returns matching knowledge entries. Useful for AI to look up project rules and patterns.

### New MCP Tool: `deprecate_knowledge`

```typescript
deprecate_knowledge({
  knowledge_id: string
})
```

Marks a knowledge entry as `deprecated`. Does not delete — preserves history.

### New Resource: `cc-mem://knowledge/{project}`

Returns active knowledge for a project as formatted markdown. Client auto-fetches at session start (same as `cc-mem://context/{project}`).

## 5. Multiple LLM Providers

### Architecture

```
LLMProvider (interface)
├── ZhipuProvider              (Phase 1, Chinese market)
└── OpenAICompatibleProvider   (Phase 2, covers all OpenAI-compatible APIs)
```

### OpenAICompatibleProvider

```typescript
class OpenAICompatibleProvider implements LLMProvider {
  constructor(config: {
    baseURL: string,
    apiKey: string,
    model: string,
    timeout?: number
  })

  async extractObservation(rawContext: string): Promise<ExtractedObservation | { skip: true }>
  async extractKnowledge(observation: Observation, existingKnowledge: Knowledge[]): Promise<KnowledgeExtractionResult>
  async summarizeSession(observationsText: string): Promise<SessionSummary>
}
```

**Environment variables:**
```bash
CC_MEM_LLM_PROVIDER=zhipu              # or openai-compatible (default: zhipu)
CC_MEM_LLM_BASE_URL=https://api.openai.com/v1  # for openai-compatible
CC_MEM_LLM_API_KEY=sk-xxx              # for openai-compatible
CC_MEM_LLM_MODEL=gpt-4o               # for openai-compatible
```

**Supported services via OpenAICompatibleProvider:**

| Service | baseURL |
|---------|---------|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com` |
| Ollama (local) | `http://localhost:11434/v1` |
| Any OpenAI proxy | User-configured |

### LLMProvider Interface Update

Add `extractKnowledge` method:

```typescript
interface LLMProvider {
  extractObservation(rawContext: string): Promise<ExtractedObservation | { skip: true }>
  summarizeSession(observationsText: string): Promise<SessionSummary>
  extractKnowledge(observation: Observation, existingKnowledge: Knowledge[]): Promise<KnowledgeExtractionResult>
}
```

`KnowledgeExtractionResult`:
```typescript
type KnowledgeExtractionResult =
  | { action: 'create', kind: string, entity: string, summary: string, detail?: string }
  | { action: 'skip', reason: string }
  | { action: 'duplicate', existing_id: string }
```

### Provider Selection (src/index.ts)

```typescript
const providerName = process.env.CC_MEM_LLM_PROVIDER || 'zhipu'
let llm: LLMProvider

if (providerName === 'zhipu') {
  llm = new ZhipuProvider({ apiKey, model })
} else {
  llm = new OpenAICompatibleProvider({
    baseURL: process.env.CC_MEM_LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.CC_MEM_LLM_API_KEY || '',
    model: process.env.CC_MEM_LLM_MODEL || 'gpt-4o',
  })
}
```

## 6. Enhanced Concepts Extraction

**Change**: Modify the observation extraction prompt in both providers to generate broader concept tags.

**Before (Phase 1):**
```
concepts 从这些中选择: how-it-works, why-it-exists, what-changed, workaround,
performance, security, api-design, architecture, config
```

**After (Phase 2):**
```
concepts 包含两部分:
1. 从这些选择: how-it-works, why-it-exists, what-changed, workaround,
   performance, security, api-design, architecture, config
2. 额外添加 3-5 个同义/相关标签，帮助语义检索。
   例如: "认证"相关 → ["auth", "认证", "鉴权", "JWT", "登录"]
   例如: "数据库"相关 → ["database", "数据库", "DB", "SQL", "查询"]
```

This makes FTS5 search find semantically related content without vector embeddings.

## 7. Updated MCP Interface Summary

### Tools (Phase 1: 7 → Phase 2: 10)

| # | Tool | Phase | Description |
|---|------|-------|-------------|
| 1 | add_observation | 1 | Add observation (raw_context or structured) |
| 2 | search | 1 | FTS5/LIKE search |
| 3 | get_context | 1 | Recent observations + session summary |
| 4 | summarize | 1 | Generate session summary |
| 5 | review_observation | 1+2 | Confirm/reject/deprecate/promote |
| 6 | list_projects | 1 | List projects with activity |
| 7 | delete_observation | 1 | Delete an observation |
| 8 | **extract_knowledge** | 2 | Extract knowledge from observation |
| 9 | **query_knowledge** | 2 | Query knowledge base |
| 10 | **deprecate_knowledge** | 2 | Deprecate a knowledge entry |

### Resources (Phase 1: 1 → Phase 2: 2)

| Resource | Phase | Description |
|----------|-------|-------------|
| `cc-mem://context/{project}` | 1 | Recent observations + session summary |
| **`cc-mem://knowledge/{project}`** | 2 | Active knowledge for project |

### Prompts (unchanged)

| Prompt | Phase | Description |
|--------|-------|-------------|
| usage-guide | 1 | How to use cc-mem |

## 8. File Structure Changes

### New files
```
src/db/knowledge.ts                    # KnowledgeRepo CRUD
src/llm/providers/openai-compatible.ts # OpenAI-compatible provider
src/tools/extract-knowledge.ts         # extract_knowledge tool
src/tools/query-knowledge.ts           # query_knowledge tool
src/tools/deprecate-knowledge.ts       # deprecate_knowledge tool
__tests__/db/knowledge.test.ts         # Knowledge repo tests
__tests__/llm/openai-compatible.test.ts # OpenAI provider tests
```

### Modified files
```
src/db/migrations.ts          # Add v2 migration (knowledge table)
src/llm/provider.ts           # Add extractKnowledge to interface
src/llm/providers/zhipu.ts    # Implement extractKnowledge + enhanced concepts prompt
src/server.ts                  # Register 3 new tools + 1 new resource
src/index.ts                   # Provider selection logic
src/tools/review-observation.ts # Add promote action
```

## 9. Error Handling

- Knowledge extraction LLM failure: return error message, don't write partial knowledge
- Duplicate knowledge: return `{already_exists: id}` instead of creating
- Missing observation_id in extract_knowledge: return error
- Invalid kind in promote: return error with valid kinds list
- Provider connection failure: same cooldown mechanism as Phase 1 (3 failures → 5min cooldown)

## 10. Roadmap After Phase 2

Phase 3 remains as designed:
- `--mode server` with PostgreSQL backend
- Multi-user, permissions
- Team shared memory
- REST API + SDK
- Vector index (if broad concepts prove insufficient)
- Security hardening
