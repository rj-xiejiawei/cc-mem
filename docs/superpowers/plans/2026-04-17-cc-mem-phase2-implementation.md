# cc-mem Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Knowledge Layer to cc-mem — knowledge table, extraction tool, promotion workflow, multiple LLM providers, enhanced concepts.

**Architecture:** Extend Phase 1's MCP server with new DB migration (v2), knowledge repo, 3 new tools + 1 new resource, OpenAI-compatible provider. LLM-based semantic dedup for knowledge extraction.

**Tech Stack:** TypeScript, Node.js, sql.js, @modelcontextprotocol/sdk, uuid (v7)

**Spec:** `docs/superpowers/specs/2026-04-17-cc-mem-phase2-design.md`

---

## File Structure

```
src/
├── db/
│   ├── knowledge.ts                    # KnowledgeRepo CRUD
│   └── migrations.ts                   # Add v2 migration
├── llm/
│   ├── provider.ts                     # Add extractKnowledge to interface
│   └── providers/
│       ├── zhipu.ts                    # Implement extractKnowledge + enhanced concepts
│       └── openai-compatible.ts        # New provider
├── tools/
│   ├── extract-knowledge.ts            # New tool
│   ├── query-knowledge.ts              # New tool
│   ├── deprecate-knowledge.ts          # New tool
│   └── review-observation.ts           # Add promote action
├── server.ts                           # Register new tools + resource
└── index.ts                            # Provider selection
__tests__/
├── db/
│   └── knowledge.test.ts
└── llm/
    └── openai-compatible.test.ts
```

---

## Chunk 1: Knowledge Table + Repo

### Task 1: Knowledge Table Migration

**Files:**
- Modify: `src/db/migrations.ts`

- [ ] **Step 1: Add v2 migration with knowledge table, indexes, FTS5, and triggers**

Add to MIGRATIONS object:
```typescript
2: [
  `CREATE TABLE knowledge (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    entity TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    source_observation_id TEXT REFERENCES observations(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active',
    project TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX idx_knowledge_kind ON knowledge(kind)`,
  `CREATE INDEX idx_knowledge_entity ON knowledge(entity)`,
  `CREATE INDEX idx_knowledge_project ON knowledge(project)`,
  `CREATE INDEX idx_knowledge_status ON knowledge(status)`,
  `CREATE INDEX idx_knowledge_source_obs ON knowledge(source_observation_id)`,
  `CREATE VIRTUAL TABLE knowledge_fts USING fts5(summary, detail, kind, entity)`,
  `CREATE TRIGGER knowledge_fts_insert AFTER INSERT ON knowledge BEGIN
    INSERT INTO knowledge_fts(rowid, summary, detail, kind, entity)
    VALUES (NEW.rowid, NEW.summary, NEW.detail, NEW.kind, NEW.entity);
  END`,
  `CREATE TRIGGER knowledge_fts_update AFTER UPDATE ON knowledge BEGIN
    DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;
    INSERT INTO knowledge_fts(rowid, summary, detail, kind, entity)
    VALUES (NEW.rowid, NEW.summary, NEW.detail, NEW.kind, NEW.entity);
  END`,
  `CREATE TRIGGER knowledge_fts_delete AFTER DELETE ON knowledge BEGIN
    DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;
  END`,
]
```

- [ ] **Step 2: Run `npm run build` to verify**

### Task 2: KnowledgeRepo

**Files:**
- Create: `src/db/knowledge.ts`

- [ ] **Step 1: Write KnowledgeRepo with create, getById, listByProject, listBySourceObservation, updateStatus, delete**

Follow the same pattern as `observations.ts` and `sessions.ts`. Key points:
- `create()` takes `CreateKnowledgeInput`, returns `Knowledge` (no dedup in repo — LLM handles it)
- `listByProject()` accepts optional filters: `{ kind?, entity?, status?, limit? }`
- `listBySourceObservation()` finds knowledge derived from an observation
- `updateStatus()` only changes status between 'active' and 'deprecated'

- [ ] **Step 2: Run `npm run build` to verify**

### Task 3: Knowledge Repo Tests

**Files:**
- Create: `__tests__/db/knowledge.test.ts`

- [ ] **Step 1: Write tests covering:**
  - Create knowledge entry
  - Get by ID
  - List by project with filters (kind, entity, status)
  - List by source observation
  - Update status (active → deprecated)
  - Delete knowledge
  - ON DELETE SET NULL behavior when observation is deleted

- [ ] **Step 2: Run `npm test` and verify all pass**

---

## Chunk 2: LLM Provider Updates

### Task 4: Update LLMProvider Interface

**Files:**
- Modify: `src/llm/provider.ts`

- [ ] **Step 1: Add extractKnowledge method to LLMProvider interface**

```typescript
export interface KnowledgeExtractionResult =
  | { action: 'create'; kind: string; entity: string; summary: string; detail?: string }
  | { action: 'skip'; reason: string }
  | { action: 'duplicate'; existing_id: string }

export interface LLMProvider {
  extractObservation(rawContext: string): Promise<ExtractedObservation | { skip: true }>
  summarizeSession(observationsText: string): Promise<SessionSummary>
  extractKnowledge(observation: Observation, existingKnowledge: Knowledge[]): Promise<KnowledgeExtractionResult>
}
```

Also export `Knowledge` type from here (re-export from db/knowledge.ts).

### Task 5: Implement extractKnowledge in ZhipuProvider

**Files:**
- Modify: `src/llm/providers/zhipu.ts`

- [ ] **Step 1: Add knowledge extraction system prompt**

```typescript
const KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT = `你是一个知识提取器。根据下面的观察记录和已有知识，判断这条观察是否包含值得长期保存的知识。

规则：
1. 只提取有持久价值的知识（规范、决策、约束、流程、模式）
2. 跳过：一次性事实、临时状态、状态更新
3. kind 只能是: rule（规范）, adr（架构决策）, constraint（约束）, procedure（流程）, pattern（模式）
4. entity: 模块/领域，如 'auth', 'payment', 'api'
5. summary: 一句话，祈使句
6. detail: 可选，2-3 句说明原因和做法
7. 检查已有知识 — 如果语义相似的知识已存在，返回 {action: "duplicate", existing_id: "..."}

已有知识：
{existing_knowledge_list}

观察记录：
{observation_content}

严格输出 JSON：
{"action":"create","kind":"...","entity":"...","summary":"...","detail":"..."}
{"action":"skip","reason":"..."}
{"action":"duplicate","existing_id":"..."}`
```

- [ ] **Step 2: Implement extractKnowledge method using call()**

Same pattern as extractObservation — use the `call()` method, parse JSON response.

- [ ] **Step 3: Update observation extraction prompt to include broader concepts**

Add the Phase 2 concepts enhancement:
```
concepts 包含两部分:
1. 从这些选择: how-it-works, why-it-exists, what-changed, workaround, performance, security, api-design, architecture, config
2. 额外添加 3-5 个同义/相关标签，帮助语义检索。
   例如: "认证"相关 → ["auth", "认证", "鉴权", "JWT", "登录"]
```

### Task 6: OpenAI-Compatible Provider

**Files:**
- Create: `src/llm/providers/openai-compatible.ts`

- [ ] **Step 1: Write OpenAICompatibleProvider implementing LLMProvider**

Same structure as ZhipuProvider but:
- Uses configurable `baseURL` (defaults to OpenAI)
- Same chat completions format
- Same prompts (observation extraction, knowledge extraction, summarization)
- Same cooldown mechanism (3 failures → 5min)

```typescript
export class OpenAICompatibleProvider implements LLMProvider {
  private baseURL: string
  private apiKey: string
  private model: string
  private timeout: number
  private consecutiveFailures = 0
  private cooldownUntil = 0

  constructor(config: { baseURL: string; apiKey: string; model: string; timeout?: number }) {
    this.baseURL = config.baseURL
    this.apiKey = config.apiKey
    this.model = config.model
    this.timeout = config.timeout ?? 10_000
  }
  // ... same methods as ZhipuProvider but against this.baseURL
}
```

- [ ] **Step 2: Run `npm run build`**

### Task 7: Provider Tests

**Files:**
- Create: `__tests__/llm/openai-compatible.test.ts`

- [ ] **Step 1: Write tests for OpenAICompatibleProvider:**
  - Constructor with baseURL, apiKey, model
  - extractObservation (mock fetch)
  - extractKnowledge (mock fetch, dedup)
  - summarizeSession (mock fetch)
  - Cooldown mechanism
  - Timeout (AbortController)
  - Empty API key error

- [ ] **Step 2: Run `npm test` and verify all pass**

---

## Chunk 3: MCP Tools + Server + Entry Point

### Task 8: Knowledge Tools

**Files:**
- Create: `src/tools/extract-knowledge.ts`
- Create: `src/tools/query-knowledge.ts`
- Create: `src/tools/deprecate-knowledge.ts`

- [ ] **Step 1: Write extract-knowledge.ts**

Zod schema: `{ observation_id: z.string() }`
Flow: get observation → get existing knowledge → call llm.extractKnowledge() → create knowledge if action='create' → return result

- [ ] **Step 2: Write query-knowledge.ts**

Zod schema: `{ project?: z.string(), kind?: z.string(), entity?: z.string(), query?: z.string(), status?: z.string(), limit?: z.number() }`
Flow: if `query` param → use SearchRepo with LIKE fallback on knowledge table; else → KnowledgeRepo.listByProject()

- [ ] **Step 3: Write deprecate-knowledge.ts**

Zod schema: `{ knowledge_id: z.string() }`
Flow: KnowledgeRepo.updateStatus(id, 'deprecated')

- [ ] **Step 4: Run `npm run build`**

### Task 9: Update review_observation + Server + Index

**Files:**
- Modify: `src/tools/review-observation.ts`
- Modify: `src/server.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add promote action to review-observation.ts**

Add 'promote' to action validation. When action is 'promote':
1. Get observation
2. Get existing knowledge for dedup
3. Call llm.extractKnowledge(observation, existingKnowledge)
4. If action='create' → KnowledgeRepo.create()
5. Update observation status to 'promoted'
6. If already promoted → return existing knowledge via listBySourceObservation

- [ ] **Step 2: Register new tools + resource in server.ts**

Add:
- `extract_knowledge` tool
- `query_knowledge` tool
- `deprecate_knowledge` tool
- `cc-mem://knowledge/{project}` resource

- [ ] **Step 3: Add provider selection in index.ts**

```typescript
const providerName = process.env.CC_MEM_LLM_PROVIDER || 'zhipu'
let llm: LLMProvider
if (providerName === 'zhipu') {
  llm = new ZhipuProvider({ apiKey, model })
} else {
  const baseURL = process.env.CC_MEM_LLM_BASE_URL
  if (!baseURL) {
    console.error('CC_MEM_LLM_BASE_URL required for openai-compatible provider')
    process.exit(1)
  }
  llm = new OpenAICompatibleProvider({
    baseURL,
    apiKey: process.env.CC_MEM_LLM_API_KEY || '',
    model: process.env.CC_MEM_LLM_MODEL || 'gpt-4o',
  })
}
```

- [ ] **Step 4: Run `npm run build` and `npm test`**

---

## Chunk 4: Final Verification + Commit

### Task 10: Full Build + Test + Commit

- [ ] **Step 1: Run `npm run build` — 0 errors**
- [ ] **Step 2: Run `npm test` — all tests pass**
- [ ] **Step 3: Commit all Phase 2 files**

```bash
git add src/ __tests__/ docs/
git commit -m "feat: add Phase 2 Knowledge Layer — knowledge table, extraction, multi-provider"
```
