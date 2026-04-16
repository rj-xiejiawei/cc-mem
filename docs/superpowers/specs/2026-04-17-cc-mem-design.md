# cc-mem Design Spec

> Cross-session memory system for AI coding assistants, with Zhipu API as default LLM provider.

## 1. Overview

cc-mem is an open-source, MCP-first memory system that helps AI coding assistants (Claude Code, Codex, Copilot, etc.) remember context across sessions. Unlike claude-mem which tightly couples to Claude Code hooks, cc-mem exposes all capabilities through standard MCP tools and resources — any MCP-compatible client can use it.

**Core value**: AI assistants can store, search, and retrieve structured observations from past sessions, eliminating the "amnesia" problem when starting a new conversation.

**Target user**: Individual developers (Phase 1), with a clean migration path to team/enterprise use (Phase 3).

**License**: MIT

## 2. Architecture

```
+---------------------------------------------+
|  Claude Code / Codex / Copilot / any MCP AI  |
+------------------+--------------------------+
                   | MCP (stdio)
                   v
+---------------------------------------------+
|  cc-mem MCP Server                          |
|                                             |
|  +-----------+  +----------------------+    |
|  | Resources |  | Tools                |    |
|  | · context |  | · add_observation    |    |
|  | · session |  | · search             |    |
|  |           |  | · get_context        |    |
|  |           |  | · summarize          |    |
|  |           |  | · review_observation |    |
|  |           |  | · list_projects      |    |
|  |           |  | · delete_observation |    |
|  +-----------+  +----------------------+    |
|  +--------------------------------------+   |
|  | LLMProvider (interface)              |   |
|  |  └─ ZhipuProvider (default)          |   |
|  |     · observation extraction         |   |
|  |     · session summarization          |   |
|  +--------------------------------------+   |
|  +--------------------------------------+   |
|  | Storage                              |   |
|  | · sql.js (WASM SQLite)              |   |
|  | · FTS5 full-text search              |   |
|  | · [reserved] vector index interface  |   |
|  +--------------------------------------+   |
+---------------------------------------------+
```

### Data Flow

1. **Record**: AI assistant calls `add_observation` tool. If `raw_context` provided, LLM extracts structured fields; if structured fields provided directly, LLM is skipped.
2. **Retrieve**: AI assistant calls `get_context` or reads `cc-mem://context/{project}` resource. Returns recent observations + last session summary.
3. **Search**: AI assistant calls `search` tool. FTS5 full-text search with optional filters.
4. **Summarize**: At session end, AI assistant calls `summarize`. LLM generates structured summary.
5. **Review**: User can review pending observations via `review_observation` tool.

### Key Design Decisions

- **No background worker**: MCP server is the only process. No extra port, no service management.
- **No IDE hooks**: All capabilities via MCP. Claude Code plugin adapter is a future optional layer.
- **sql.js over better-sqlite3**: Avoids native addon compilation issues across platforms. Pure WASM, zero native dependencies.
- **LLMProvider interface**: Zhipu is default, but interface is defined from day one for extensibility.

## 3. Database Schema

```sql
-- Session tracking
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project TEXT,
  started_at TEXT,
  ended_at TEXT,
  summary TEXT,                      -- JSON from LLM summarization
  discovery_tokens INTEGER DEFAULT 0 -- Token cost of this session
);

-- Core observations
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  type TEXT,                         -- bugfix | feature | refactor | change | discovery | decision
  title TEXT NOT NULL,               -- One-line title (5-15 chars Chinese)
  narrative TEXT,                     -- Detailed description (2-5 sentences)
  facts TEXT,                        -- JSON array, key facts
  concepts TEXT,                     -- JSON array, tags (how-it-works, why-it-exists, etc.)
  files_read TEXT,                   -- JSON array
  files_modified TEXT,               -- JSON array
  project TEXT,                      -- Project identifier
  content_hash TEXT,                 -- SHA256 dedup
  prompt_number INTEGER,             -- Which turn generated this
  status TEXT DEFAULT 'confirmed',   -- pending | confirmed | deprecated
  reviewed_at TEXT,                  -- When reviewed
  created_at TEXT,
  discovery_tokens INTEGER DEFAULT 0
);

-- Full-text search
CREATE VIRTUAL TABLE observations_fts USING fts5(
  title, narrative, facts, concepts,
  content='observations', content_rowid='rowid'
);

-- User prompts for search
CREATE TABLE user_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  content TEXT,
  created_at TEXT
);

-- Schema versioning
CREATE TABLE schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT
);

-- [Phase 2] Knowledge table — extracted structured knowledge
-- CREATE TABLE knowledge (
--   id TEXT PRIMARY KEY,
--   kind TEXT,          -- rule | adr | constraint | contract | procedure | pattern
--   entity TEXT,        -- Module/domain, e.g. 'auth', 'payment'
--   summary TEXT,
--   detail TEXT,
--   source_observation_id TEXT,
--   status TEXT DEFAULT 'active',  -- active | deprecated
--   reviewed_by TEXT,
--   created_at TEXT
-- );

-- [Phase 2] Vector embeddings
-- CREATE TABLE embeddings (
--   observation_id TEXT REFERENCES observations(id),
--   vector BLOB,
--   model TEXT
-- );
```

### Deduplication

- `content_hash` = SHA256(title + narrative)
- Within a single session, only the first observation with a given hash is kept
- 30-second sliding window for duplicate detection

## 4. MCP Interface

### Tools

```typescript
// 1. Add an observation
add_observation({
  type?: string,           // bugfix | feature | refactor | change | discovery | decision
  title?: string,          // Required if no raw_context
  narrative?: string,
  facts?: string[],
  concepts?: string[],
  files_read?: string[],
  files_modified?: string[],
  raw_context?: string,    // If provided, LLM extracts all fields automatically
  project?: string,        // Defaults to current working directory project name
  status?: string          // Defaults to 'confirmed', can be 'pending'
})
// Returns: { id, type, title }
// If raw_context provided: calls LLM (~2s), then stores
// If structured fields provided: stores directly, no LLM call

// 2. Search memories
search({
  query: string,           // FTS5 search query
  limit?: number,          // Default 10
  type?: string,           // Filter by type
  project?: string,        // Filter by project
  status?: string,         // Filter by status
  since?: string           // ISO timestamp
})
// Returns: { results: [{ id, type, title, narrative, created_at, score }] }

// 3. Get context for a project
get_context({
  project?: string,        // Defaults to cwd project
  limit?: number           // Default 20
})
// Returns: { observations: [...], last_summary: {...}, stats: {...} }

// 4. Generate session summary
summarize({
  session_id: string
})
// Calls LLM to generate structured summary, stores in sessions table
// Returns: { request, investigated, learned, completed, next_steps }

// 5. Review an observation
review_observation({
  id: string,
  action: "confirm" | "reject" | "deprecate"
})
// Updates status field. "reject" deletes the observation.

// 6. List projects
list_projects()
// Returns: [{ project, observation_count, last_activity }]

// 7. Delete observation
delete_observation({ id: string })
```

### Resources

```typescript
// Formatted context for injection into system prompt
"cc-mem://context/{project}"
// Returns markdown-formatted recent context, e.g.:
// [cc-mem] recent context, 2026-04-17 10:30am GMT+8
//
// Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
// Format: ID TIME TYPE TITLE
//
// ### Apr 17, 2026
// 3 10:15a ✅ User chose Approach A for cc-mem architecture
// 4 10:20a ⚖️ Decided to use glm-4-flash for all LLM calls
//
// Stats: 4 obs (1,200t read) | 50,000t work | 96% savings

// Full session record
"cc-mem://session/{session_id}"
```

### Prompts

```typescript
// Usage guide injected into AI system prompt
"cc-mem://prompts/usage-guide"
// Instructs the AI assistant when to use each tool:
// - Completing significant work → add_observation (with raw_context)
// - Starting a new task → get_context
// - Need to find history → search
// - Session ending → summarize
```

## 5. LLM Integration

### LLMProvider Interface

```typescript
interface LLMProvider {
  extractObservation(rawContext: string): Promise<ExtractedObservation | { skip: true }>;
  summarizeSession(observations: Observation[]): Promise<SessionSummary>;
}

interface ExtractedObservation {
  type: string;
  title: string;
  narrative: string;
  facts: string[];
  concepts: string[];
  files_read: string[];
  files_modified: string[];
}

interface SessionSummary {
  request: string;
  investigated: string[];
  learned: string[];
  completed: string[];
  next_steps: string[];
}
```

### ZhipuProvider (Default)

- **API**: `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- **Model**: `glm-4-flash` (cheapest, fastest, sufficient for extraction/summarization)
- **Timeout**: 10 seconds
- **Cost estimate**: ~0.7 tokens per observation extraction, ~1.3 tokens per summary

### Observation Extraction Prompt

```
你是一个工作记忆提取器。从下面的对话内容中提取一条结构化观察记录。

规则：
1. 只记录有持久价值的信息（学到了什么、决定了什么、发现了什么）
2. 跳过：状态查询、确认消息、格式化输出、无实质内容的操作
3. title 用祈使句，5-15 字中文
4. narrative 用 2-5 句，说明发生了什么和为什么重要
5. facts 提取关键数字、文件名、配置项等可检索事实
6. type 只能是: bugfix, feature, refactor, change, discovery, decision
7. concepts 从这些中选择: how-it-works, why-it-exists, what-changed,
   workaround, performance, security, api-design, architecture, config

严格输出 JSON，不要其他文字：
{
  "type": "...",
  "title": "...",
  "narrative": "...",
  "facts": ["..."],
  "concepts": ["..."],
  "files_read": ["..."],
  "files_modified": ["..."]
}

如果没有值得记录的内容，输出：{"skip": true}

对话内容：
{raw_context}
```

### Session Summary Prompt

```
你是一个会话总结器。根据下面的观察记录，生成一份工作会话摘要。

规则：
1. request: 用一句话说用户这次想做什么
2. investigated: 探索了哪些方向
3. learned: 关键发现和洞察
4. completed: 实际完成了什么
5. next_steps: 如果有未完成的工作，下一步应该做什么
6. 语言和原始内容保持一致（中文用中文）

输出 JSON：
{
  "request": "...",
  "investigated": ["..."],
  "learned": ["..."],
  "completed": ["..."],
  "next_steps": ["..."]
}

观察记录：
{observations}
```

### Error Handling for LLM Calls

- Timeout: 10 seconds
- JSON parse failure: attempt to strip markdown code blocks, then retry parse. If still fails, skip silently.
- Consecutive failures: after 3 consecutive failures, enter 5-minute cooldown (skip all LLM calls)
- **Never block the AI assistant's normal work** — LLM is enhancement, not requirement

## 6. Project Structure

```
cc-mem/
├── package.json
├── README.md
├── tsconfig.json
├── src/
│   ├── index.ts                    # MCP server entry point
│   ├── server.ts                   # MCP server definition (tools/resources/prompts)
│   ├── db/
│   │   ├── database.ts             # sql.js connection management
│   │   ├── migrations.ts           # Schema version management
│   │   ├── observations.ts         # observations CRUD + FTS5 sync
│   │   ├── sessions.ts             # sessions CRUD
│   │   └── search.ts               # FTS5 search logic
│   ├── llm/
│   │   ├── provider.ts             # LLMProvider interface
│   │   └── providers/
│   │       └── zhipu.ts            # Zhipu API implementation
│   ├── tools/
│   │   ├── add-observation.ts
│   │   ├── search.ts
│   │   ├── get-context.ts
│   │   ├── summarize.ts
│   │   ├── review-observation.ts
│   │   ├── list-projects.ts
│   │   └── delete-observation.ts
│   └── utils/
│       ├── hash.ts                 # content_hash (SHA256)
│       └── format.ts              # Context formatting for resources
├── claude-code-plugin/            # [Phase 2] Claude Code plugin adapter
│   └── plugin.json
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-04-17-cc-mem-design.md  # This file
```

## 7. Configuration

All configuration via environment variables (zero config files):

```bash
# Required
CC_MEM_ZHIPU_API_KEY=xxx              # Zhipu API key

# Optional
CC_MEM_LLM_PROVIDER=zhipu             # LLM provider (default: zhipu)
CC_MEM_ZHIPU_MODEL=glm-4-flash        # Model (default: glm-4-flash)
CC_MEM_DB_PATH=~/.cc-mem/memories.db  # Database path (default: ~/.cc-mem/memories.db)
CC_MEM_LOG_LEVEL=info                 # debug | info | warn | error
```

### Installation

**Primary (recommended):**
```bash
npm install -g cc-mem
```

```json
// ~/.claude/settings.json → mcpServers
{
  "cc-mem": {
    "command": "cc-mem",
    "env": {
      "CC_MEM_ZHIPU_API_KEY": "xxx"
    }
  }
}
```

**Fallback (try without installing):**
```json
{
  "cc-mem": {
    "command": "npx",
    "args": ["-y", "cc-mem"],
    "env": {
      "CC_MEM_ZHIPU_API_KEY": "xxx"
    }
  }
}
```

Data directory: `~/.cc-mem/` (isolated from plugin system). Backup = copy the single `.db` file.

## 8. Error Handling & Edge Cases

### LLM Failures
- Timeout: 10s, then skip
- JSON parse: strip markdown wrapping, retry. Still fails → skip silently
- Consecutive 3 failures → 5-minute cooldown, skip all LLM calls
- **Principle: never block AI assistant's normal operation**

### Database
- sql.js loaded from npm package (bundled WASM)
- WAL mode equivalent via sql.js's built-in concurrency handling
- Auto-run migrations on startup
- If DB file corrupted: rename to `.bak`, create fresh DB, log warning

### Duplicate Detection
- SHA256(title + narrative) as content_hash
- Within one session, same hash → skip
- 30-second sliding window

### Performance Targets
- MCP server startup: < 2s
- `search` / `get_context`: < 100ms (pure SQLite)
- `add_observation` (no LLM): < 50ms
- `add_observation` (with LLM): < 15s
- Memory usage: < 50MB

### sql.js Fallback
- If WASM loading fails (rare): operate in memory-only mode, log warning, don't crash
- Data won't persist but system stays functional

## 9. Roadmap

### Phase 1 (Current) — Core Memory
- observations + sessions + FTS5
- 7 MCP tools
- ZhipuProvider + LLMProvider interface
- sql.js storage
- npm package distribution

### Phase 2 — Knowledge Layer
- `knowledge` table (Decision, Constraint, Fact, Procedure, Pattern)
- LLM-powered knowledge extraction from observations
- `review_observation` → knowledge promotion workflow
- Additional LLM providers (OpenAI-compatible, DeepSeek)
- Claude Code plugin adapter
- Vector index interface (sqlite-vec)

### Phase 3 — Team Platform
- `--mode server` with PostgreSQL backend
- Multi-user, permissions
- Team shared memory space
- REST API + SDK (TS/Python)
- Security hardening (auth, encryption, audit log)
- Memory Inbox UI
