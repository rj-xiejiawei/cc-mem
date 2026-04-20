# cc-mem 使用指南与竞品对比

## 快速安装

```bash
# 发布到 npm 后，用户只需在 MCP 配置中添加：
{
  "mcpServers": {
    "cc-mem": {
      "command": "npx",
      "args": ["-y", "@krab-jw/cc-mem"],
      "env": {
        "CC_MEM_ZHIPU_API_KEY": "your-zhipu-api-key"
      }
    }
  }
}
```

重启 Claude Code / Cursor / 任意 MCP 客户端即可使用。

> 获取智谱 API Key：访问 https://open.bigmodel.cn/ 注册，免费额度足够日常使用。

---

## 场景化对比：cc-mem vs claude-mem

### 场景 1：跨会话调试 Continuity

**背景：** 昨天花了两小时排查数据库连接池泄漏，今天继续。

| | 没有 Memory | claude-mem | cc-mem |
|---|---|---|---|
| **体验** | 重新解释问题背景，AI 毫无记忆 | 自动注入昨天的观察，但压缩质量取决于 Claude API | `get_context` 获取最近观察 + 知识库沉淀的结论 |
| **成本** | 浪费 token 重复描述 | 需要调用 Claude API 压缩观察（贵） | 用智谱 glm-4-flash 压缩（几乎免费） |
| **区别** | - | 被动注入，你控制不了注入了什么 | 主动调用，精确获取需要的上下文 |

### 场景 2：架构决策留存

**背景：** 三周前决定用 sql.js 而不是 better-sqlite3，现在 AI 可能建议迁移。

| | 没有 Memory | claude-mem | cc-mem |
|---|---|---|---|
| **体验** | AI 反复建议相互矛盾的方案 | 全文搜索能找到相关讨论 | `query_knowledge` 精确找到 Decision 类型的知识条目 |
| **区别** | - | 只有观察级别的记忆，没有结构化知识 | Knowledge Layer 支持结构化知识类型：Decision / Constraint / Fact / Pattern / Procedure |

**cc-mem 独有：** `extract_knowledge` 工具从观察中自动提取结构化知识，支持 promote（观察→知识）工作流。

### 场景 3：多客户端使用

**背景：** 你在 Claude Code 写代码，Cursor 做前端，偶尔用 Claude Desktop 讨论方案。

| | claude-mem | cc-mem |
|---|---|---|
| **Claude Code** | 支持（原生插件） | 支持（MCP stdio） |
| **Cursor** | 不支持 | 支持（MCP stdio） |
| **Claude Desktop** | 支持（MCP tools） | 支持（MCP stdio） |
| **Copilot / Cline / 其他** | 不支持 | 支持（任何 MCP 客户端） |
| **Gemini CLI / OpenCode** | 支持（需要额外安装） | 支持（MCP stdio） |

**关键差异：** claude-mem 深度绑定 Claude Code hooks 生态；cc-mem 基于 MCP 标准，**任何支持 MCP 的客户端即插即用**。

### 场景 4：部署和资源占用

**背景：** 你的机器已经在跑 Docker、数据库、IDE，不想再加后台服务。

| | claude-mem | cc-mem |
|---|---|---|
| **后台进程** | 需要 Bun 运行时 + Worker 服务（端口 37777） | 无后台进程，MCP stdio 按需启动 |
| **额外依赖** | Bun + uv (Python) + Chroma 向量数据库 | 无（纯 Node.js，零原生依赖） |
| **端口占用** | 占用 37777 端口 | 无端口占用 |
| **安装复杂度** | `npx claude-mem install` + 需要安装 Bun | 写 5 行 JSON 配置即可 |
| **磁盘占用** | SQLite + Chroma 向量索引 | 单个 SQLite 文件（sql.js WASM） |

**cc-mem 优势：** 纯 stdio 通信，MCP 客户端管理生命周期，服务器不需要自己管进程。包体仅 34KB。

### 场景 5：成本控制

**背景：** 你是一个独立开发者或小团队，在意每分钱的花费。

| | claude-mem | cc-mem |
|---|---|---|
| **LLM 压缩** | 调用 Claude API（$3-15/百万 token） | 调用智谱 glm-4-flash（免费额度 + 极低单价） |
| **向量搜索** | Chroma 向量数据库（本地运行） | FTS5 全文搜索（轻量） |
| **结构化输入** | 无，必须经过 LLM 压缩 | 支持直接传入结构化观察，**零 LLM 调用** |
| **月成本估算** | $5-20（取决于使用频率） | $0-2（智谱免费额度基本够用） |

**cc-mem 省钱技巧：** 用结构化输入（`type`, `title`, `facts`, `concepts`）添加观察，完全不需要 LLM 调用。

### 场景 6：数据安全和隐私

**背景：** 你在处理公司内部项目，代码不能外泄。

| | claude-mem | cc-mem |
|---|---|---|
| **LLM 调用** | 必须调用 Claude API（数据发送到 Anthropic） | 可配置任意 OpenAI 兼容端点（可自部署） |
| **数据存储** | 本地 SQLite + Chroma | 本地 SQLite 单文件 |
| **开源协议** | AGPL-3.0（商用有传染性限制） | MIT（完全自由，商用无限制） |
| **自部署 LLM** | 不支持 | 支持 OpenAI 兼容协议，可用 Ollama / vLLM 本地模型 |

**cc-mem 独有：** 配置 `CC_MEM_LLM_PROVIDER=openai-compatible` + `CC_MEM_LLM_BASE_URL=http://localhost:11434/v1` 即可用本地 Ollama，数据完全不离开你的机器。

### 场景 7：知识沉淀与传承

**背景：** 项目做了一年，团队成员来来去去，需要沉淀项目知识。

| | 没有 Memory | claude-mem | cc-mem |
|---|---|---|---|
| **知识留存** | 散落在 commit message、Slack、文档 | 自动压缩为观察记录 | 观察记录 + 结构化知识库（5 种类型） |
| **知识检索** | 靠人记忆 | 全文 + 向量搜索 | FTS5 全文搜索 |
| **知识分类** | 无 | 无 | Decision / Constraint / Fact / Pattern / Procedure |
| **知识生命周期** | 无 | 观察永久保留 | 知识有 promoted / deprecated 状态管理 |

---

## 核心优势总结

| 维度 | cc-mem 优势 |
|---|---|
| **即插即用** | 5 行 JSON 配置，`npx -y @krab-jw/cc-mem`，无需安装任何依赖 |
| **零后台进程** | 纯 stdio，MCP 客户端管理生命周期，不占端口不占内存 |
| **极低成本** | 智谱 glm-4-flash 免费额度够用，支持结构化输入零 LLM 调用 |
| **全客户端支持** | Claude Code / Cursor / Copilot / Cline / Claude Desktop / 任意 MCP 客户端 |
| **数据不出本机** | 支持自部署 LLM（Ollama / vLLM），完全不联网也能用 |
| **MIT 协议** | 商用完全自由，无传染性限制 |
| **Knowledge Layer** | 结构化知识沉淀（Decision / Constraint / Fact / Pattern / Procedure） |
| **多 LLM Provider** | 智谱 / OpenAI 兼容 / 任意自部署模型 |

---

## 适用人群

- 想要**轻量、零配置**跨会话记忆的独立开发者
- 使用**多个 AI 编码工具**（Cursor + Claude Code + Copilot）的开发者
- 需要**数据完全本地**、不希望发送到第三方 API 的企业用户
- **中文开发者**，需要中文优化的 LLM 提取
- 想要**控制成本**、不希望为记忆功能每月多花 $10-20 的用户
- 需要**结构化知识管理**（不仅是观察记录）的长期项目

---

## 不适用场景

- 需要**语义向量搜索**（如 "找一个跟这个 bug 类似的问题"）—— 目前 cc-mem 只有 FTS5 关键词搜索，向量搜索在 Roadmap 中
- 需要**团队实时共享记忆** —— Phase 3 才会支持 PostgreSQL 多用户模式
- 已经深度使用 claude-mem 且满足需求的用户 —— 迁移成本不值得

---

## 工具速查

| 工具 | 用途 | 何时用 |
|---|---|---|
| `add_observation` | 记录观察 | 完成重要工作、发现 bug、做出决策时 |
| `search` | 全文搜索 | 需要找历史记录时 |
| `get_context` | 获取项目上下文 | 新会话开始时 |
| `summarize` | LLM 生成摘要 | 会话结束时 |
| `extract_knowledge` | 提取结构化知识 | 从观察中提炼决策、约束、模式时 |
| `query_knowledge` | 查询知识库 | 需要查阅项目决策和技术约束时 |
| `deprecate_knowledge` | 废弃知识 | 知识过时时 |
| `review_observation` | 审核/确认/提升观察 | 审核 AI 提取的观察质量时 |
| `list_projects` | 列出所有项目 | 查看有哪些项目的记忆时 |
| `delete_observation` | 删除观察 | 清理错误记录时 |
