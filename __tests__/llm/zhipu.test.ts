import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ZhipuProvider } from '../../src/llm/providers/zhipu.js'

describe('ZhipuProvider', () => {
  let provider: ZhipuProvider
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
    provider = new ZhipuProvider({
      apiKey: 'test-api-key',
      model: 'test-model',
      timeout: 5000,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
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

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(provider.extractObservation('Test')).rejects.toThrow('API 500')
    })

    it('should throw on timeout', async () => {
      mockFetch.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)))

      await expect(provider.extractObservation('Test')).rejects.toThrow()
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

  describe('parseResponse', () => {
    it('should parse valid JSON', () => {
      const result = provider.parseResponse('{"type":"discovery","title":"Test"}')
      expect(result).toEqual({ type: 'discovery', title: 'Test' })
    })

    it('should parse JSON with markdown code block', () => {
      const result = provider.parseResponse('```json\n{"type":"discovery","title":"Test"}\n```')
      expect(result).toEqual({ type: 'discovery', title: 'Test' })
    })

    it('should parse JSON with plain markdown code block', () => {
      const result = provider.parseResponse('```\n{"type":"discovery","title":"Test"}\n```')
      expect(result).toEqual({ type: 'discovery', title: 'Test' })
    })

    it('should return null on invalid JSON', () => {
      const result = provider.parseResponse('not json at all')
      expect(result).toBeNull()
    })

    it('should handle trailing whitespace', () => {
      const result = provider.parseResponse('  {"type":"discovery"}  ')
      expect(result).toEqual({ type: 'discovery' })
    })

    it('should parse skip response', () => {
      const result = provider.parseResponse('{"skip": true}')
      expect(result).toEqual({ skip: true })
    })
  })

  describe('cooldown mechanism', () => {
    it('should not trigger cooldown after single failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(provider.extractObservation('Test')).rejects.toThrow()

      // Should not be in cooldown yet
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })

      await expect(provider.extractObservation('Test')).resolves.toEqual({ skip: true })
    })

    it('should trigger cooldown after 3 consecutive failures', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      // Fail 3 times
      await expect(provider.extractObservation('Test 1')).rejects.toThrow()
      await expect(provider.extractObservation('Test 2')).rejects.toThrow()
      await expect(provider.extractObservation('Test 3')).rejects.toThrow()

      // 4th call should be in cooldown
      await expect(provider.extractObservation('Test 4')).rejects.toThrow('LLM in cooldown')
    })

    it('should reset failure counter on success', async () => {
      // Fail twice
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      await expect(provider.extractObservation('Test 1')).rejects.toThrow()

      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      await expect(provider.extractObservation('Test 2')).rejects.toThrow()

      // Succeed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })
      await expect(provider.extractObservation('Test 3')).resolves.toEqual({ skip: true })

      // Fail again - should not trigger cooldown (only 1 failure)
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      await expect(provider.extractObservation('Test 4')).rejects.toThrow()
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
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        })
      )
    })

    it('should use custom base URL if provided', async () => {
      const customProvider = new ZhipuProvider({
        apiKey: 'test-key',
        model: 'test-model',
        baseUrl: 'https://custom.api.com/v1/chat',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"skip": true}' } }],
        }),
      })

      await customProvider.extractObservation('Test')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.com/v1/chat',
        expect.any(Object)
      )
    })

    it('should abort request on timeout', async () => {
      const slowProvider = new ZhipuProvider({
        apiKey: 'test-key',
        model: 'test-model',
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
})
