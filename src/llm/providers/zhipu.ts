import type {
  LLMProvider,
  ExtractedObservation,
  SessionSummary,
} from '../provider.js'

const EXTRACTION_SYSTEM_PROMPT = `你是一个工作记忆提取器。从下面的对话内容中提取一条结构化观察记录。

规则：
1. 只记录有持久价值的信息（学到了什么、决定了什么、发现了什么）
2. 跳过：状态查询、确认消息、格式化输出、无实质内容的操作
3. title 用祈使句，5-15 字中文
4. narrative 用 2-5 句，说明发生了什么和为什么重要
5. facts 提取关键数字、文件名、配置项等可检索事实
6. type 只能是: bugfix, feature, refactor, change, discovery, decision
7. concepts 从这些中选择: how-it-works, why-it-exists, what-changed, workaround, performance, security, api-design, architecture, config

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

export class ZhipuProvider implements LLMProvider {
  private apiKey: string
  private model: string
  private baseUrl: string
  private timeout: number
  private consecutiveFailures = 0
  private cooldownUntil = 0

  constructor(config: {
    apiKey: string
    model: string
    baseUrl?: string
    timeout?: number
  }) {
    this.apiKey = config.apiKey
    this.model = config.model
    this.baseUrl =
      config.baseUrl ||
      'https://open.bigmodel.cn/api/paas/v4/chat/completions'
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

  parseResponse(
    text: string
  ): ExtractedObservation | SessionSummary | { skip: true } | null {
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

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(this.baseUrl, {
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
