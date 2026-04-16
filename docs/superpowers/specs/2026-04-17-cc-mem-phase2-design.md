# cc-mem Phase 2 — Knowledge Layer Design Spec

**Date**: 2026-04-17
**Status**: Draft (post-review revision)
**Depends on**: Phase 1 (complete)

## 1. Overview

Phase 2 adds a structured knowledge layer on top of Phase 1's observation memory. Observations capture what happened; knowledge captures what was learned and what matters long-term.

**Approach**: Manual/on-demand knowledge extraction (Plan A) — user or AI triggers extraction from observations. LLM deduplicates against existing knowledge before writing.

**Scope**:
- Knowledge table + CRUD + FTS5 search
- Knowledge extraction tool (LLM-powered, with semantic dedup)
- Knowledge promotion via review_observation enhancement
- Multiple LLM providers (OpenAI-compatible covering DeepSeek, Ollama, and any OpenAI-compatible API)
- Enhanced concepts extraction (broader synonyms for FTS5 semantic coverage)

**Out of scope** (deferred):
- Vector index — FTS5 + broad concepts covers semantic gaps
- Claude Code plugin adapter — MCP Resources already solve auto-injection
- Automatic knowledge extraction — LLM lacks context to judge correctly at observation time
- Anthropic native provider — Anthropic API is not OpenAI-compatible; requires separate provider (future work). Users needing Anthropic can use an OpenAI-compatible proxy.

## 2. Knowledge Table

### Schema Changes from Phase 1 Placeholder

Phase 1 spec included a commented-out knowledge table as a placeholder. Phase 2 makes these intentional changes:
- `contract` kind merged into `adr` (contract-style decisions are a subset of architecture decisions)
- `reviewed_by` removed — review is implicit via `source_observation_id` (knowledge created by extraction/promotion is already vetted)
- `project` added explicitly for multi-project support (Phase 1 placeholder didn't include it)
- `updated_at` removed — knowledge is immutable once created; deprecate + recreate is the update path

### Migration v2

```sql
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,           -- rule | adr | constraint | procedure | pattern
  entity TEXT NOT NULL,         -- Module/domain, e.g. 'auth', 'payment'
  summary TEXT NOT NULL,        -- One-line summary
  detail TEXT,                  -- Detailed description (optional)
  source_observation_id TEXT REFERENCES observations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | deprecated
  project TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_knowledge_kind ON knowledge(kind);
CREATE INDEX idx_knowledge_entity ON knowledge(entity);
CREATE INDEX idx_knowledge_project ON knowledge(project);
CREATE INDEX idx_knowledge_status ON knowledge(status);
CREATE INDEX idx_knowledge_source_obs ON knowledge(source_observation_id);

-- FTS5 for knowledge (with fallback for sql.js without FTS5)
CREATE VIRTUAL TABLE knowledge_fts USING fts5(summary, detail, kind, entity);
CREATE TRIGGER knowledge_fts_insert AFTER INSERT ON knowledge BEGIN
  INSERT INTO knowledge_fts(rowid, summary, detail, kind, entity)
  VALUES (NEW.rowid, NEW.summary, NEW.detail, NEW.kind, NEW.entity);
END;
CREATE TRIGGER knowledge_fts_update AFTER UPDATE ON knowledge BEGIN
  DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;
  INSERT INTO knowledge_fts(rowid, summary, detail, kind, entity)
  VALUES (NEW.rowid, NEW.summary, NEW.detail, NEW.kind, NEW.entity);
END;
CREATE TRIGGER knowledge_fts_delete AFTER DELETE ON knowledge BEGIN
  DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;
END;
```

**Note**: FTS5 statements are skipped when FTS5 is unavailable (same pattern as Phase 1's `observations_fts`). LIKE fallback is used for knowledge search in that case.

**Cascade behavior**: `source_observation_id` uses `ON DELETE SET NULL`. When an observation is deleted, its derived knowledge is NOT deleted (preserves knowledge independence). The `source_observation_id` becomes NULL, indicating the original observation no longer exists.

### Observation Status Update

Add `promoted` to the observation status enum. Migration v2 also updates:
```sql
-- Observations status now includes: pending | confirmed | deprecated | promoted
-- No schema change needed (TEXT column), but documented in code
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
interface Knowledge {
  id: string
  kind: string
  entity: string
  summary: string
  detail: string | null
  source_observation_id: string | null
  status: string           // active | deprecated
  project: string
  created_at: string
}

class KnowledgeRepo {
  create(input: CreateKnowledgeInput): Knowledge
  getById(id: string): Knowledge | undefined
  listByProject(project: string, options?: { kind?, entity?, status?, limit? }): Knowledge[]
  listBySourceObservation(observationId: string): Knowledge[]
  updateStatus(id: string, status: 'active' | 'deprecated'): void  // Status only, not content
  delete(id: string): void
}
```

**Dedup strategy**: LLM-based semantic dedup only. The `extract_knowledge` flow sends existing knowledge to the LLM, which decides if the new extraction duplicates an existing entry. No hash-based pre-check — knowledge summarization is subjective; different wording of the same concept should be caught by LLM comparison, not hash matching.

## 3. Knowledge Extraction Tool

### New MCP Tool: `extract_knowledge`

```typescript
extract_knowledge({
  observation_id: string  // The observation to extract from
})
```

**Flow:**
1. Read the observation by ID
2. Query existing active knowledge for the same project (for dedup context)
3. Send to LLM with extraction prompt:
   - Present existing knowledge list (semantic dedup)
   - 5 kind categories with definitions
   - Entity extraction guidance (module/domain granularity)
   - Summary: one sentence; Detail: optional expansion
4. LLM returns one of:
   - `{action: "create", kind, entity, summary, detail}` → write to knowledge table
   - `{action: "skip", reason}` → not worth extracting
   - `{action: "duplicate", existing_id}` → semantically duplicates existing knowledge
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
7. Check existing knowledge — if semantically similar already exists, return {action: "duplicate", existing_id: "..."}

Existing knowledge for this project:
{existing_knowledge_list}

Observation:
{observation_content}

Output JSON only:
{"action":"create","kind":"...","entity":"...","summary":"...","detail":"..."}
{"action":"skip","reason":"..."}
{"action":"duplicate","existing_id":"..."}
```

## 4. Promotion Workflow

### Enhanced `review_observation` Tool

Add `promote` action. **Backward compatible** — `id` parameter name kept from Phase 1.

```typescript
review_observation({
  id: string,                                                    // Phase 1 name preserved
  action: 'confirm' | 'reject' | 'deprecate' | 'promote',       // new: promote
  kind?: string,        // Optional hint for promote (LLM may override)
  entity?: string       // Optional hint for promote (LLM may override)
})
```

**Action behaviors:**
| Action | Behavior |
|--------|----------|
| `confirm` | Set status to `confirmed` (Phase 1) |
| `reject` | Delete the observation (Phase 1) |
| `deprecate` | Set status to `deprecated` (Phase 1) |
| `promote` | Extract knowledge from observation, set status to `promoted` (Phase 2) |
```

**Promote flow:**
1. Read observation content
2. Query existing knowledge for dedup context
3. Use LLM to transform observation into knowledge format. If `kind` and `entity` are provided, they are used as hints to guide the LLM — the LLM may override them if the observation content suggests a different classification.
4. Write to knowledge table with `source_observation_id`
5. Update observation status to `promoted`

**Idempotency**: If the observation is already `promoted`, return the existing knowledge entry (found via `source_observation_id` lookup). No duplicate knowledge is created.

**Traceability**: `KnowledgeRepo.listBySourceObservation(observationId)` returns all knowledge derived from a given observation.

### New MCP Tool: `query_knowledge`

```typescript
query_knowledge({
  project?: string,
  kind?: string,
  entity?: string,
  query?: string,        // FTS5/LIKE search across summary + detail + kind + entity
  status?: string,       // active | deprecated (default: active)
  limit?: number
})
```

Returns matching knowledge entries. When `query` is provided, uses FTS5 (or LIKE fallback) to search knowledge content. Without `query`, returns filtered list.

### New MCP Tool: `deprecate_knowledge`

```typescript
deprecate_knowledge({
  knowledge_id: string
})
```

Marks a knowledge entry as `deprecated`. Does not delete — preserves history. To update knowledge, deprecate the old entry and extract/create new.

### New Resource: `cc-mem://knowledge/{project}`

Returns active knowledge for a project as formatted markdown. Grouped by kind.

**Example output:**
```
[cc-mem] Knowledge for my-project (5 entries)

## Rules
• auth: All API responses use { code, data, message }
• config: Environment variables via .env, never hardcoded

## ADR
• storage: Use sql.js over better-sqlite3 for zero native deps

## Constraints
• auth: Max concurrent connections: 100

## Patterns
• error: Error handling: try/catch + logger.error
```

Client auto-fetches at session start (same as `cc-mem://context/{project}`).

## 5. Multiple LLM Providers

### Architecture

```
LLMProvider (interface)
├── ZhipuProvider              (Phase 1, Chinese market)
└── OpenAICompatibleProvider   (Phase 2, covers all OpenAI-compatible APIs)
```

**Note**: Anthropic's API is NOT OpenAI-compatible (different message format, different endpoint). It is NOT covered by `OpenAICompatibleProvider`. Users needing Anthropic should use an OpenAI-compatible proxy, or wait for a future native Anthropic provider implementation.

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

**API key validation**: Same as Zhipu (Phase 1). Key is validated on first LLM call. If missing or invalid, returns error message. System works without key for structured-only `add_observation` calls. Error on first call: `"LLM API key not configured. Set CC_MEM_LLM_API_KEY for provider 'openai-compatible'."`

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
| 2 | search | 1 | FTS5/LIKE search (observations only) |
| 3 | get_context | 1 | Recent observations + session summary |
| 4 | summarize | 1 | Generate session summary |
| 5 | review_observation | 1+2 | Confirm/reject/deprecate/promote |
| 6 | list_projects | 1 | List projects with activity |
| 7 | delete_observation | 1 | Delete an observation |
| 8 | **extract_knowledge** | 2 | Extract knowledge from observation |
| 9 | **query_knowledge** | 2 | Query/search knowledge base |
| 10 | **deprecate_knowledge** | 2 | Deprecate a knowledge entry |

**Note**: `search` (tool #2) searches observations only. Knowledge has its own search via `query_knowledge` with `query` parameter. Keeping them separate avoids confusion — observations and knowledge have different schemas and use cases.

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
__tests__/db/knowledge.test.ts         # Knowledge repo + FTS5 tests
__tests__/llm/openai-compatible.test.ts # OpenAI provider tests
```

### Modified files
```
src/db/migrations.ts          # Add v2 migration (knowledge table + FTS5 + triggers)
src/llm/provider.ts           # Add extractKnowledge to interface
src/llm/providers/zhipu.ts    # Implement extractKnowledge + enhanced concepts prompt
src/server.ts                  # Register 3 new tools + 1 new resource
src/index.ts                   # Provider selection logic
src/tools/review-observation.ts # Add promote action (keep 'id' param for backward compat)
```

## 9. Error Handling

- Knowledge extraction LLM failure: return error message, don't write partial knowledge
- Duplicate knowledge (LLM-detected): return `{action: "duplicate", existing_id}` instead of creating
- Missing observation_id in extract_knowledge: return error
- Invalid kind in promote: return error with valid kinds list
- Provider connection failure: same cooldown mechanism as Phase 1 (3 failures → 5min cooldown)
- Empty API key for openai-compatible: error on first LLM call, not at startup

## 10. Test Coverage Requirements

### knowledge.test.ts
- Create knowledge entry
- Get by ID
- List by project with filters (kind, entity, status)
- List by source observation
- Update status (active → deprecated)
- Delete knowledge
- FTS5 search (or LIKE fallback) on summary/detail
- ON DELETE SET NULL behavior when observation deleted

### openai-compatible.test.ts
- Constructor with baseURL, apiKey, model
- extractObservation (mock fetch)
- extractKnowledge (mock fetch, dedup logic)
- summarizeSession (mock fetch)
- Cooldown mechanism (3 failures → 5min)
- Timeout behavior (AbortController)
- Empty API key error message

### Promotion tests (in existing test files)
- review_observation with promote action
- Observation status changes to `promoted`
- Kind/entity hints passed to LLM
- Knowledge created with source_observation_id
- Promoting already-promoted observation (idempotent)

## 11. Roadmap After Phase 2

Phase 3 remains as designed:
- `--mode server` with PostgreSQL backend
- Multi-user, permissions
- Team shared memory
- REST API + SDK
- Anthropic native provider
- Vector index (if broad concepts prove insufficient)
- Security hardening
