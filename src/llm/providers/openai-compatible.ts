import type {
  LLMProvider,
  ExtractedObservation,
  SessionSummary,
  Knowledge,
  KnowledgeExtractionInput,
  KnowledgeExtractionResult,
} from '../provider.js'

const EXTRACTION_SYSTEM_PROMPT = `你是一个工作记忆提取器。从下面的对话内容中提取一条结构化观察记录。

规则：
1. 只记录有持久价值的信息（学到了什么、决定了什么、发现了什么）
2. 跳过：状态查询、确认消息、格式化输出、无实质内容的操作
3. title 用祈使句，5-15 字中文
4. narrative 用 2-5 句，说明发生了什么和为什么重要
5. facts 提取关键数字、文件名、配置项等可检索事实
6. type 只能是: bugfix, feature, refactor, change, discovery, decision
7. concepts 包含两部分:
   1. 从这些选择: how-it-works, why-it-exists, what-changed, workaround, performance, security, api-design, architecture, config
   2. 额外添加 3-5 个同义/相关标签，帮助语义检索。
      例如: "认证"相关 → ["auth", "认证", "鉴权", "JWT", "登录"]
      例如: "数据库"相关 → ["database", "数据库", "DB", "SQL", "查询"]

严格输出 JSON，不要其他文字：
{"type":"...","title":"...","narrative":"...","facts":["..."],"concepts":["..."],"files_read":["..."],"files_modified":["..."]}

如果没有值得记录的内容，输出：{"skip": true}`

const SUMMARY_SYSTEM_PROMPT = `你是一个会话总结器。根据下面的观察记录，生成一份工作会话摘要。

规则：
1. request: 用一句话说用户这次想做什么
2. investigated: 探索了哪些方向
3. learned: 关键发现和洞察
4. completed: 实际完成了什么
5. next_steps: 如果有未完成的工作，下一步应该做什么
6. 语言和原始内容保持一致（中文用中文）

输出 JSON：
{"request":"...","investigated":["..."],"learned":["..."],"completed":["..."],"next_steps":["..."]}`

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

export class OpenAICompatibleProvider implements LLMProvider {
  private baseURL: string
  private apiKey: string
  private model: string
  private timeout: number
  private consecutiveFailures = 0
  private cooldownUntil = 0

  constructor(config: {
    baseURL: string
    apiKey: string
    model: string
    timeout?: number
  }) {
    this.baseURL = config.baseURL
    this.apiKey = config.apiKey
    this.model = config.model
    this.timeout = config.timeout ?? 10_000
  }

  async extractObservation(
    rawContext: string
  ): Promise<ExtractedObservation | { skip: true }> {
    const response = await this.call(rawContext, EXTRACTION_SYSTEM_PROMPT)
    const parsed = this.parseResponse(response)
    if (!parsed || (parsed as { skip: true }).skip) return { skip: true }
    return parsed as ExtractedObservation
  }

  async summarizeSession(
    observationsText: string
  ): Promise<SessionSummary> {
    const response = await this.call(observationsText, SUMMARY_SYSTEM_PROMPT)
    const parsed = this.parseResponse(response) as SessionSummary | null
    if (!parsed)
      return {
        request: '',
        investigated: [],
        learned: [],
        completed: [],
        next_steps: [],
      }
    return parsed
  }

  async extractKnowledge(
    observation: KnowledgeExtractionInput,
    existingKnowledge: Knowledge[]
  ): Promise<KnowledgeExtractionResult> {
    const existingList = existingKnowledge
      .map((k) => `[${k.id}] ${k.kind}/${k.entity}: ${k.summary}`)
      .join('\n')

    const observationContent = `标题: ${observation.kind || ''} - ${observation.title}\n叙述: ${observation.narrative || ''}\n事实: ${observation.facts || ''}\n概念: ${observation.concepts || ''}`

    const systemPrompt = KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT
      .replace('{existing_knowledge_list}', existingList || '（无）')
      .replace('{observation_content}', observationContent)

    const response = await this.call(observationContent, systemPrompt)
    const parsed = this.parseResponse(response)
    if (!parsed) return { action: 'skip', reason: 'Failed to parse LLM response' }
    return parsed as KnowledgeExtractionResult
  }

  parseResponse(
    text: string
  ): ExtractedObservation | SessionSummary | KnowledgeExtractionResult | { skip: true } | null {
    let clean = text.trim()
    if (clean.startsWith('```')) {
      clean = clean
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '')
    }
    try {
      return JSON.parse(clean)
    } catch {
      return null
    }
  }

  private async call(
    userContent: string,
    systemPrompt: string
  ): Promise<string> {
    if (Date.now() < this.cooldownUntil) {
      throw new Error('LLM in cooldown')
    }

    if (!this.apiKey) {
      throw new Error(`LLM API key not configured. Set CC_MEM_LLM_API_KEY for provider 'openai-compatible'.`)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const url = `${this.baseURL.replace(/\/$/, '')}/chat/completions`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.1,
        }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)

      const data = (await res.json()) as {
        choices: { message: { content: string } }[]
      }
      this.consecutiveFailures = 0
      return data.choices[0]?.message?.content ?? ''
    } catch (e) {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= 3) {
        this.cooldownUntil = Date.now() + 5 * 60 * 1000
        this.consecutiveFailures = 0
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}
