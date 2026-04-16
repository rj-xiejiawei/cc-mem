
⏺ 好，方案 A 确认。逐节展示设计，每节确认后再继续。

  ---
  设计 Section 1: 整体架构 & 数据流

  ┌─────────────────────────────────────────┐
  │  Claude Code / Codex / Copilot          │
  │  (任何支持 MCP 的 AI 助手)               │
  └────────────┬────────────────────────────┘
               │ MCP (stdio)
               ▼
  ┌─────────────────────────────────────────┐
  │  cc-mem MCP Server                      │
  │                                         │
  │  ┌───────────┐  ┌──────────────────┐    │
  │  │ Resources │  │ Tools            │    │
  │  │ · context │  │ · add_observation│    │
  │  │ · history │  │ · search         │    │
  │  │           │  │ · get_context    │    │
  │  └───────────┘  │ · summarize      │    │
  │                 └──────────────────┘    │
  │  ┌──────────────────────────────────┐   │
  │  │ LLM Client (智谱 API)            │   │
  │  │ · observation 提取               │   │
  │  │ · session 摘要                   │   │
  │  └──────────────────────────────────┘   │
  │  ┌──────────────────────────────────┐   │
  │  │ Storage                          │   │
  │  │ · SQLite (数据)                  │   │
  │  │ · FTS5 (全文搜索)                │   │
  │  │ · [预留] 向量索引接口             │   │
  │  └──────────────────────────────────┘   │
  └─────────────────────────────────────────┘

  数据流:

  1. 记录: AI 助手调用 add_observation tool → LLM 提取结构化记忆 → 存
  SQLite
  2. 检索: AI 助手调用 get_context tool 或读 context resource →
  返回相关记忆
  3. 搜索: AI 助手调用 search tool → FTS5 全文搜索
  4. 摘要: 会话结束时调用 summarize tool → LLM 生成 session 摘要

  关键决策: 不依赖 Claude Code hooks。所有能力通过 MCP tools/resources
   暴露，让 AI 助手自己决定什么时候记、什么时候查。Hook
  适配层作为可选的 Claude Code 插件后补。

  这个架构方向 OK 吗？

✻ Worked for 42s

❯ ok

⏺ 设计 Section 2: 数据库设计

  -- 会话追踪
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,           -- UUID
    project TEXT,                  -- 项目路径/名称
    started_at TEXT,               -- ISO 时间戳
    ended_at TEXT,
    summary TEXT,                  -- LLM 生成的摘要 JSON
    discovery_tokens INTEGER DEFAULT 0  -- 本次会话消耗的 token
  );

  -- 核心记忆表
  CREATE TABLE observations (
    id TEXT PRIMARY KEY,           -- UUID
    session_id TEXT REFERENCES sessions(id),
    type TEXT,                     --
  bugfix/feature/refactor/change/discovery/decision
    title TEXT NOT NULL,           -- 一句话标题
    narrative TEXT,                -- 详细描述 (2-5 句)
    facts TEXT,                    -- JSON 数组, 关键事实
    concepts TEXT,                 -- JSON 数组, 标签 (how-it-works,
  why-it-exists 等)
    files_read TEXT,               -- JSON 数组
    files_modified TEXT,           -- JSON 数组
    project TEXT,                  -- 项目标识
    content_hash TEXT,             -- 去重用
    prompt_number INTEGER,         -- 第几轮对话产生的
    created_at TEXT,
    discovery_tokens INTEGER DEFAULT 0
  );

  -- 全文搜索
  CREATE VIRTUAL TABLE observations_fts USING fts5(
    title, narrative, facts, concepts,
    content='observations', content_rowid='rowid'
  );

  -- 用户原始 prompt (用于搜索)
  CREATE TABLE user_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    content TEXT,
    created_at TEXT
  );

  -- Schema 版本管理
  CREATE TABLE schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at TEXT
  );

  设计要点:
  - observations 是核心，存储结构化记忆
  - observations_fts 是 FTS5 虚拟表，自动同步，支持中文分词
  - content_hash 防止同一会话内重复记录
  - discovery_tokens 追踪"发现成本"，后续可以显示记忆价值
  - 向量索引预留为未来的独立表 embeddings(observation_id, vector)

  这个数据模型 OK 吗？

❯ ok

⏺ 设计 Section 3: MCP Tools & Resources 接口

  Tools（AI 助手主动调用）

  // 1. 添加观察记录
  add_observation({
    type: "bugfix" | "feature" | "refactor" | "change" | "discovery" |
   "decision",
    title: string,           // 一句话
    narrative: string,       // 详细描述
    facts?: string[],        // 关键事实
    concepts?: string[],     // 标签
    files_read?: string[],
    files_modified?: string[],
    raw_context?: string     // 原始对话内容，用于 LLM 提取
  })
  // 如果提供了 raw_context，会调用智谱 API 自动提取结构化字段
  // 如果直接提供结构化字段，跳过 LLM 调用，直接存储

  // 2. 搜索记忆
  search({
    query: string,           // 搜索关键词
    limit?: number,          // 默认 10
    type?: string,           // 按类型过滤
    project?: string,        // 按项目过滤
    since?: string           // ISO 时间戳，只返回之后的
  })

  // 3. 获取当前项目的上下文
  get_context({
    project?: string,        // 默认当前项目
    limit?: number           // 默认 20 条最近的
  })
  // 返回: 最近 observations + 上次 session summary

  // 4. 生成会话摘要
  summarize({
    session_id: string
  })
  // 调用智谱 API，生成 session summary 并存储

  // 5. 列出项目
  list_projects()
  // 返回所有有记忆的项目列表

  // 6. 手动删除记忆
  delete_observation({ id: string })

  Resources（AI 助手按需读取）

  // 读取当前项目的上下文 (自动注入到 system prompt)
  "cc-mem://context/{project}"
  // 返回格式化的记忆摘要，类似:
  // [cc-mem] recent context, 2026-04-16
  //
  // ### Apr 16, 2026
  // 1 4:45p ✅ Claude-Mem Provider and API Key Configuration
  // 2 4:46p ✅ Claude-Mem Settings Configuration
  // ...

  // 读取指定 session 的完整记录
  "cc-mem://session/{session_id}"

  Prompts（预定义提示模板）

  // 注入到 AI 助手的 system prompt 中，指导它何时使用记忆
  "cc-mem://prompts/usage-guide"
  // 内容: "你接入了 cc-mem 记忆系统。在以下时机使用对应工具:
  //   - 完成重要工作 → add_observation (带 raw_context)
  //   - 开始新任务 → get_context
  //   - 需要查找历史 → search
  //   - 会话结束 → summarize"

  关键设计: add_observation 支持两种模式——给 raw_context 让 LLM
  自动提取，或直接给结构化字段跳过 LLM。这样简单操作（比如记录一个
  decision）不需要 API 调用。


⏺ 设计 Section 4: 项目结构 & 配置

  目录结构

  cc-mem/
  ├── package.json
  ├── README.md
  ├── src/
  │   ├── index.ts                # MCP server 入口
  │   ├── server.ts               # MCP server 定义
  (tools/resources/prompts)
  │   ├── db/
  │   │   ├── database.ts         # SQLite 连接管理
  │   │   ├── migrations.ts       # Schema 版本管理
  │   │   ├── observations.ts     # observations CRUD + FTS5
  │   │   ├── sessions.ts         # sessions CRUD
  │   │   └── search.ts           # FTS5 搜索逻辑
  │   ├── llm/
  │   │   ├── client.ts           # 智谱 API 客户端
  │   │   ├── extractor.ts        # observation 提取 prompt
  │   │   └── summarizer.ts       # session 摘要 prompt
  │   ├── tools/
  │   │   ├── add-observation.ts
  │   │   ├── search.ts
  │   │   ├── get-context.ts
  │   │   ├── summarize.ts
  │   │   ├── list-projects.ts
  │   │   └── delete-observation.ts
  │   └── utils/
  │       ├── hash.ts             # content hash
  │       └── format.ts           # context 格式化输出
  ├── claude-code-plugin/
  │   └── plugin.json             # Claude Code 插件适配 (后续)
  └── tsconfig.json

  配置方式

  通过环境变量（零配置文件）：

  # 必需
  CC_MEM_ZHIPU_API_KEY=xxx        # 智谱 API key

  # 可选
  CC_MEM_ZHIPU_MODEL=glm-4-flash  # 默认 glm-4-flash (便宜快速)
  CC_MEM_DB_PATH=~/.cc-mem/memories.db  # 默认 ~/.cc-mem/memories.db
  CC_MEM_LOG_LEVEL=info           # debug/info/warn/error

  安装方式

  npm 安装 (核心):
  // ~/.claude/settings.json → mcpServers
  {
    "cc-mem": {
      "command": "npx",
      "args": ["-y", "cc-mem"],
      "env": {
        "CC_MEM_ZHIPU_API_KEY": "xxx"
      }
    }
  }

  Claude Code 插件 (后续):
  // 适配层，自动注入 env 和 hooks
  {
    "cc-mem@community": true
  }

  设计要点:
  - 纯 TypeScript，编译为单文件 JS，npx -y cc-mem 零安装直接跑
  - 数据目录 ~/.cc-mem/，和插件系统隔离
  - 配置只通过环境变量，不引入配置文件
  - claude-code-plugin/ 目录预留，Phase 2 实现


采用omc 去执行,要用 ralph + team的能力，