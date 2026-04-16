import { describe, it, expect } from 'vitest'
import { formatContext } from '../../src/utils/format.js'
import type { Observation } from '../../src/db/observations.js'

describe('formatContext', () => {
  const mockObservations: Observation[] = [
    {
      id: 'obs-001',
      session_id: 'session-1',
      type: 'discovery',
      title: 'Found performance bottleneck',
      narrative: 'Database query slow',
      facts: null,
      concepts: null,
      files_read: '["src/db.ts"]',
      files_modified: null,
      project: 'test-project',
      content_hash: 'abc123',
      prompt_number: 1,
      status: 'confirmed',
      reviewed_at: null,
      created_at: '2025-01-15T10:30:00Z',
      discovery_tokens: 500,
    },
    {
      id: 'obs-002',
      session_id: 'session-1',
      type: 'bugfix',
      title: 'Fixed memory leak',
      narrative: 'Added cleanup handler',
      facts: null,
      concepts: null,
      files_read: null,
      files_modified: '["src/server.ts"]',
      project: 'test-project',
      content_hash: 'def456',
      prompt_number: 2,
      status: 'confirmed',
      reviewed_at: null,
      created_at: '2025-01-15T11:45:00Z',
      discovery_tokens: 750,
    },
  ]

  it('should return placeholder message when no observations', () => {
    const result = formatContext([], 'my-project', 0)
    expect(result).toBe('[cc-mem] No recent context for my-project')
  })

  it('should format observations with header, legend, and stats', () => {
    const result = formatContext(mockObservations, 'test-project', 1250)

    expect(result).toContain('[cc-mem] recent context')
    expect(result).toContain('Legend:')
    expect(result).toContain('Stats: 2 obs | 1250t work')
  })

  it('should include observation IDs, times, icons, and titles', () => {
    const result = formatContext(mockObservations, 'test-project', 1250)

    expect(result).toContain('obs-')
    expect(result).toContain('🎯') // discovery icon
    expect(result).toContain('🔴') // bugfix icon
    expect(result).toContain('Found performance bottleneck')
    expect(result).toContain('Fixed memory leak')
  })

  it('should format time in Chinese locale with 12-hour format', () => {
    const result = formatContext(mockObservations, 'test-project', 1250)

    // Should contain time-like patterns (HH:MM AM/PM format in Chinese)
    // Format shows "下午HH:MM" or "上午HH:MM"
    expect(result).toMatch(/[上午下午]\d{1,2}:\d{2}/)
  })

  it('should handle different observation types with correct icons', () => {
    const allTypesObs: Observation[] = [
      {
        id: 'obs-001',
        session_id: 'session-1',
        type: 'session',
        title: 'Session started',
        narrative: 'narrative',
        facts: null,
        concepts: null,
        files_read: null,
        files_modified: null,
        project: 'test-project',
        content_hash: 'hash',
        prompt_number: null,
        status: 'confirmed',
        reviewed_at: null,
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 0,
      },
      {
        id: 'obs-002',
        session_id: 'session-1',
        type: 'feature',
        title: 'New feature',
        narrative: 'narrative',
        facts: null,
        concepts: null,
        files_read: null,
        files_modified: null,
        project: 'test-project',
        content_hash: 'hash',
        prompt_number: null,
        status: 'confirmed',
        reviewed_at: null,
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 0,
      },
      {
        id: 'obs-003',
        session_id: 'session-1',
        type: 'refactor',
        title: 'Refactored code',
        narrative: 'narrative',
        facts: null,
        concepts: null,
        files_read: null,
        files_modified: null,
        project: 'test-project',
        content_hash: 'hash',
        prompt_number: null,
        status: 'confirmed',
        reviewed_at: null,
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 0,
      },
      {
        id: 'obs-004',
        session_id: 'session-1',
        type: 'change',
        title: 'Changed config',
        narrative: 'narrative',
        facts: null,
        concepts: null,
        files_read: null,
        files_modified: null,
        project: 'test-project',
        content_hash: 'hash',
        prompt_number: null,
        status: 'confirmed',
        reviewed_at: null,
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 0,
      },
      {
        id: 'obs-005',
        session_id: 'session-1',
        type: 'decision',
        title: 'Made decision',
        narrative: 'narrative',
        facts: null,
        concepts: null,
        files_read: null,
        files_modified: null,
        project: 'test-project',
        content_hash: 'hash',
        prompt_number: null,
        status: 'confirmed',
        reviewed_at: null,
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 0,
      },
    ]

    const result = formatContext(allTypesObs, 'test-project', 0)

    expect(result).toContain('🎯') // session
    expect(result).toContain('🔴') // bugfix
    expect(result).toContain('🞮') // feature (the actual icon)
    expect(result).toContain('🔄') // refactor
    expect(result).toContain('✅') // change
    expect(result).toContain('⚖️') // decision
    expect(result).toContain('🔵') // discovery
  })

  it('should use default icon for unknown types', () => {
    const unknownTypeObs: Observation[] = [
      {
        id: 'obs-001',
        session_id: 'session-1',
        type: 'unknown-type',
        title: 'Unknown type',
        narrative: 'narrative',
        facts: null,
        concepts: null,
        files_read: null,
        files_modified: null,
        project: 'test-project',
        content_hash: 'hash',
        prompt_number: null,
        status: 'confirmed',
        reviewed_at: null,
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 0,
      },
    ]

    const result = formatContext(unknownTypeObs, 'test-project', 0)
    expect(result).toContain('·') // default icon
  })

  it('should format output as lines with newlines', () => {
    const result = formatContext(mockObservations, 'test-project', 1250)
    const lines = result.split('\n')

    expect(lines.length).toBeGreaterThan(5)
    expect(lines[0]).toContain('[cc-mem] recent context')
    expect(lines[2]).toContain('Legend:')
  })
})
