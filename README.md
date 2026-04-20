# cc-mem

> Cross-session memory server for AI coding assistants — remember context across conversations.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/@krab-jw%2Fcc-mem.svg)](https://www.npmjs.com/package/@krab-jw/cc-mem)

**[中文文档](how-to-use.md)**

**cc-mem** is an open-source MCP (Model Context Protocol) server that helps AI coding assistants like Claude Code, Cursor, and Copilot remember important information across sessions. Unlike claude-mem which tightly couples to Claude Code hooks, cc-mem exposes all capabilities through standard MCP tools and resources — any MCP-compatible client can use it.

## Features

- **Cross-session memory** — AI assistants remember context from previous conversations
- **Full-text search** — FTS5-powered search across all observations
- **LLM-powered extraction** — Automatically extracts structured observations from raw context (uses Zhipu AI by default)
- **Session summaries** — Generate work session summaries with LLM
- **Multi-project support** — Separate memory spaces for different projects
- **Zero-config setup** — Works with npm global install, no service management
- **Chinese LLM support** — Built-in Zhipu AI integration, optimized for Chinese content
- **Open source** — MIT licensed, self-hosted, data stored locally

## Installation

```bash
npm install -g cc-mem
```

## Configuration

Set environment variables before starting the MCP server:

```bash
# Required for LLM-powered features
export CC_MEM_ZHIPU_API_KEY="your-zhipu-api-key"

# Optional
export CC_MEM_DB_PATH="~/.cc-mem/memories.db"  # Default: ~/.cc-mem/memories.db
export CC_MEM_ZHIPU_MODEL="glm-4-flash"        # Default: glm-4-flash
```

> **Get Zhipu API key**: Visit [https://open.bigmodel.cn/](https://open.bigmodel.cn/) and create an account.

## MCP Client Setup

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cc-mem": {
      "command": "npx",
      "args": ["-y", "@krab-jw/cc-mem"],
      "env": {
        "CC_MEM_ZHIPU_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor

Add to Cursor MCP settings:

```json
{
  "mcpServers": {
    "cc-mem": {
      "command": "npx",
      "args": ["-y", "@krab-jw/cc-mem"],
      "env": {
        "CC_MEM_ZHIPU_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cline (Claude Dev)

Add to Cline's MCP configuration:

```json
{
  "mcpServers": {
    "cc-mem": {
      "command": "npx",
      "args": ["-y", "@krab-jw/cc-mem"],
      "env": {
        "CC_MEM_ZHIPU_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Alternative: npx (without installing)

```json
{
  "mcpServers": {
    "cc-mem": {
      "command": "npx",
      "args": ["-y", "@krab-jw/cc-mem"],
      "env": {
        "CC_MEM_ZHIPU_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools

### 1. `add_observation`
Add an observation to memory. Pass `raw_context` for automatic LLM extraction, or provide structured fields directly.

**Structured input** (no LLM call):
```json
{
  "type": "bugfix",
  "title": "Fix authentication timeout",
  "narrative": "Increased timeout from 5s to 10s to handle slow network conditions.",
  "facts": ["timeout: 10s", "file: src/auth.ts"],
  "concepts": ["performance", "bugfix"],
  "files_modified": ["src/auth.ts"],
  "status": "confirmed"
}
```

**Raw context** (LLM extracts fields):
```json
{
  "raw_context": "User: Fix the auth timeout issue\nAssistant: I've increased the timeout to 10s in src/auth.ts..."
}
```

**Types**: `bugfix` | `feature` | `refactor` | `change` | `discovery` | `decision`

### 2. `search`
Search memories by keyword using full-text search.

```json
{
  "query": "authentication timeout",
  "limit": 10,
  "type": "bugfix",
  "project": "my-app",
  "status": "confirmed"
}
```

### 3. `get_context`
Get recent observations and last session summary for a project.

```json
{
  "project": "my-app",
  "limit": 20
}
```

### 4. `summarize`
Generate a session summary using LLM.

```json
{
  "session_id": "01234567-89ab-cdef-0123-456789abcdef"
}
```

Returns: `{ request, investigated, learned, completed, next_steps }`

### 5. `review_observation`
Review a pending observation: confirm, reject (delete), or deprecate.

```json
{
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "action": "confirm"
}
```

Actions: `confirm` | `reject` | `deprecate`

### 6. `list_projects`
List all projects that have stored memories.

No parameters required.

### 7. `delete_observation`
Delete an observation by ID.

```json
{
  "id": "01234567-89ab-cdef-0123-456789abcdef"
}
```

## Available Resources

### `cc-mem://context/{project}`
Project context — recent observations and last session summary.

Example: `cc-mem://context/my-app` returns markdown-formatted recent context with statistics.

### `cc-mem://session/{session_id}`
Full session record.

## Available Prompts

### `usage-guide`
How to use cc-mem memory tools.

Instructs the AI assistant when to use each tool:
- Completing significant work → `add_observation` (with `raw_context`)
- Starting a new task → `get_context`
- Need to find history → `search`
- Session ending → `summarize`

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Claude Code / Cursor / Copilot / any MCP AI    │
└─────────────────┬───────────────────────────────┘
                  │ MCP (stdio)
                  v
┌─────────────────────────────────────────────────┐
│  cc-mem MCP Server                              │
│                                                 │
│  ┌──────────┐  ┌──────────────────────────┐    │
│  │ Resources│  │ Tools                    │    │
│  │ · context│  │ · add_observation        │    │
│  │ · session│  │ · search                 │    │
│  │          │  │ · get_context            │    │
│  │          │  │ · summarize              │    │
│  └──────────┘  │ · review_observation     │    │
│                 │ · list_projects          │    │
│  ┌──────────────────────────────────────┐  │    │
│  │ LLMProvider (interface)              │  │    │
│  │  └─ ZhipuProvider (default)          │  │    │
│  │     · observation extraction         │  │    │
│  │     · session summarization          │  │    │
│  └──────────────────────────────────────┘  │    │
│  ┌──────────────────────────────────────┐  │    │
│  │ Storage                              │  │    │
│  │ · sql.js (WASM SQLite)              │  │    │
│  │ · FTS5 full-text search              │  │    │
│  └──────────────────────────────────────┘  │    │
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

- **sql.js over better-sqlite3** — Avoids native addon compilation issues across platforms. Pure WASM, zero native dependencies.
- **No background worker** — MCP server is the only process. No extra port, no service management.
- **LLMProvider interface** — Zhipu is default, but interface is defined for extensibility.
- **ID format** — All IDs are UUID v7 (time-ordered, sortable).
- **Timestamps** — All datetime fields use ISO 8601 UTC format.

## Data Storage

All data is stored locally in `~/.cc-mem/memories.db` (SQLite database via sql.js WASM).

**Database schema**:
- `sessions` — Session tracking with summaries
- `observations` — Core observations with FTS5 full-text search
- `user_prompts` — User prompts for search
- `schema_versions` — Schema version management

**Backup**: Simply copy the `.db` file to backup all memories.

## Development

```bash
# Clone the repository
git clone https://github.com/yourusername/cc-mem.git
cd cc-mem

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

### Project Structure

```
cc-mem/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── server.ts             # MCP server definition
│   ├── db/                   # Database layer
│   ├── llm/                  # LLM provider abstraction
│   ├── tools/                # MCP tool implementations
│   └── utils/                # Utilities
├── dist/                     # Compiled output
└── package.json
```

## License

MIT License — see LICENSE file for details.

## Comparison with claude-mem

| Feature | cc-mem | claude-mem |
|---------|--------|------------|
| **LLM Provider** | Zhipu AI (Chinese-optimized) | Claude API |
| **Open Source** | ✅ MIT licensed | ❌ Closed source |
| **MCP Standard** | ✅ Full MCP compliance | ❌ Claude Code hooks only |
| **Full-text Search** | ✅ FTS5-powered | ❌ Basic search |
| **Storage** | sql.js (WASM SQLite) | Proprietary |
| **Client Support** | Any MCP client | Claude Code only |
| **Data Control** | Local, self-hosted | Cloud-based |
| **Extensibility** | Pluggable LLM providers | Fixed to Claude |

## Roadmap

### Phase 1 (Current) — Core Memory
- ✅ observations + sessions + FTS5
- ✅ 7 MCP tools
- ✅ ZhipuProvider + LLMProvider interface
- ✅ sql.js storage
- ✅ npm package distribution

### Phase 2 — Knowledge Layer
- ✅ `knowledge` table (Rule, ADR, Constraint, Procedure, Pattern)
- ✅ LLM-powered knowledge extraction from observations
- ✅ Additional LLM providers (OpenAI-compatible, DeepSeek)
- ~~Claude Code plugin adapter~~ — MCP Resources already solve auto-injection
- ~~Vector index interface (sqlite-vec)~~ — FTS5 + broad concepts covers semantic gaps

### Phase 3 — Team Platform
- ⏳ PostgreSQL backend mode
- ⏳ Multi-user, permissions
- ⏳ Team shared memory space
- ⏳ REST API + SDK (TS/Python)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/cc-mem/issues)
- **Documentation**: See `docs/` directory for design specs

---

Made with ❤️ for AI-powered development
