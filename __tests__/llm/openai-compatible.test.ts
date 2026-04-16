import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OpenAICompatibleProvider } from '../../src/llm/providers/openai-compatible.js'

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
    provider = new OpenAICompatibleProvider({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'test-api-key',
      model: 'gpt-4o',
      timeout: 5000,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should use provided configuration', () => {
      const p = new OpenAICompatibleProvider({
        baseURL: 'https://api.deepseek.com',
        apiKey: 'sk-test',
        model: 'deepseek-chat',
      })
      expect(p).toBeDefined()
    })

    it('should default timeout to 10000ms', () => {
      const p = new OpenAICompatibleProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'test',
        model: 'gpt-4o',
      })
      expect(p).toBeDefined()
    })
  })

  describe('extractObservation', () => {
    it('should extract observation from context', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"type":"discovery","title":"Test","narrative":"Test narrative","facts":[],"concepts":[],"files_read":[],"files_modified":[]}' } }],
        }),
      })

      const result = await provider.extractObservation('User message about a bug')

      expect(result).toEqual({
        type: 'discovery',
        title: 'Test',
        narrative: 'Test narrative',
        facts: [],
        concepts: [],
        files_read: [],
        files_modified: [],
      })
    })

    it('should return skip when LLM returns skip', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })

      const result = await provider.extractObservation('Not worth recording')

      expect(result).toEqual({ skip: true })
    })

    it('should handle markdown code blocks in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n{"type":"discovery","title":"Test","narrative":"Test","facts":[],"concepts":[],"files_read":[],"files_modified":[]}\n```' } }],
        }),
      })

      const result = await provider.extractObservation('Context')

      expect(result).toEqual({
        type: 'discovery',
        title: 'Test',
        narrative: 'Test',
        facts: [],
        concepts: [],
        files_read: [],
        files_modified: [],
      })
    })
  })

  describe('extractKnowledge', () => {
    it('should extract create action from observation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"action":"create","kind":"rule","entity":"auth","summary":"Use JWT for all endpoints","detail":"Standardized auth approach"}' } }],
        }),
      })

      const observation = {
        id: 'obs-1', kind: 'discovery', title: 'Auth setup',
        narrative: 'Set up JWT auth', facts: null, concepts: null,
        source_observation_id: null, status: 'confirmed',
        project: 'test', created_at: '2025-01-15T10:00:00Z',
      }

      const result = await provider.extractKnowledge(observation, [])

      expect(result).toEqual({
        action: 'create',
        kind: 'rule',
        entity: 'auth',
        summary: 'Use JWT for all endpoints',
        detail: 'Standardized auth approach',
      })
    })

    it('should return duplicate when LLM detects dedup', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"action":"duplicate","existing_id":"kn-1"}' } }],
        }),
      })

      const observation = {
        id: 'obs-2', kind: 'discovery', title: 'Auth again',
        narrative: 'Similar auth observation', facts: null, concepts: null,
        source_observation_id: null, status: 'confirmed',
        project: 'test', created_at: '2025-01-15T10:00:00Z',
      }
      const existing = [{
        id: 'kn-1', kind: 'rule', entity: 'auth',
        summary: 'Use JWT for all endpoints', detail: null,
        source_observation_id: null, status: 'active',
        project: 'test', created_at: '2025-01-15T10:00:00Z',
      }]

      const result = await provider.extractKnowledge(observation, existing)

      expect(result).toEqual({
        action: 'duplicate',
        existing_id: 'kn-1',
      })
    })

    it('should return skip when LLM says not worth extracting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"action":"skip","reason":"Temporary state, no lasting knowledge"}' } }],
        }),
      })

      const observation = {
        id: 'obs-3', kind: 'change', title: 'Temporary fix',
        narrative: 'Just a temp change', facts: null, concepts: null,
        source_observation_id: null, status: 'confirmed',
        project: 'test', created_at: '2025-01-15T10:00:00Z',
      }

      const result = await provider.extractKnowledge(observation, [])

      expect(result).toEqual({
        action: 'skip',
        reason: 'Temporary state, no lasting knowledge',
      })
    })
  })

  describe('summarizeSession', () => {
    it('should summarize session observations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"request":"Test request","investigated":["direction 1"],"learned":["insight 1"],"completed":["task 1"],"next_steps":["step 1"]}' } }],
        }),
      })

      const result = await provider.summarizeSession('Observations text')

      expect(result).toEqual({
        request: 'Test request',
        investigated: ['direction 1'],
        learned: ['insight 1'],
        completed: ['task 1'],
        next_steps: ['step 1'],
      })
    })

    it('should return empty summary on parse error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'invalid json' } }],
        }),
      })

      const result = await provider.summarizeSession('Observations text')

      expect(result).toEqual({
        request: '',
        investigated: [],
        learned: [],
        completed: [],
        next_steps: [],
      })
    })
  })

  describe('cooldown mechanism', () => {
    it('should trigger cooldown after 3 consecutive failures', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(provider.extractObservation('Test 1')).rejects.toThrow()
      await expect(provider.extractObservation('Test 2')).rejects.toThrow()
      await expect(provider.extractObservation('Test 3')).rejects.toThrow()

      // 4th call should be in cooldown
      await expect(provider.extractObservation('Test 4')).rejects.toThrow('LLM in cooldown')
    })

    it('should reset failure counter on success', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      await expect(provider.extractObservation('Test 1')).rejects.toThrow()

      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      await expect(provider.extractObservation('Test 2')).rejects.toThrow()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })
      await expect(provider.extractObservation('Test 3')).resolves.toEqual({ skip: true })

      // Should not be in cooldown
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      await expect(provider.extractObservation('Test 4')).rejects.toThrow('Network error')
    })
  })

  describe('API call', () => {
    it('should call correct endpoint with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })

      await provider.extractObservation('Test')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        })
      )
    })

    it('should use custom baseURL', async () => {
      const customProvider = new OpenAICompatibleProvider({
        baseURL: 'https://api.deepseek.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })

      await customProvider.extractObservation('Test')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/chat/completions',
        expect.any(Object)
      )
    })

    it('should handle trailing slash in baseURL', async () => {
      const customProvider = new OpenAICompatibleProvider({
        baseURL: 'https://api.deepseek.com/',
        apiKey: 'test-key',
        model: 'deepseek-chat',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })

      await customProvider.extractObservation('Test')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/chat/completions',
        expect.any(Object)
      )
    })

    it('should abort request on timeout', async () => {
      const slowProvider = new OpenAICompatibleProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        model: 'gpt-4o',
        timeout: 50,
      })

      let capturedSignal: AbortSignal | null = null
      mockFetch.mockImplementationOnce((_, options) => {
        capturedSignal = options?.signal as any
        return new Promise((_, reject) => {
          if (capturedSignal?.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'))
            return
          }
          capturedSignal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          })
        })
      })

      await expect(slowProvider.extractObservation('Test')).rejects.toThrow()
      expect(capturedSignal?.aborted).toBe(true)
    }, 5000)
  })

  describe('empty API key', () => {
    it('should throw descriptive error on empty API key', async () => {
      const noKeyProvider = new OpenAICompatibleProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o',
      })

      await expect(noKeyProvider.extractObservation('Test')).rejects.toThrow(
        'LLM API key not configured'
      )
    })
  })
})
