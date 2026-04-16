import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import { SessionsRepo } from '../../src/db/sessions.js'
import fs from 'node:fs'
import os from 'node:os'

describe('SessionsRepo', () => {
  let db: Database
  let repo: SessionsRepo
  let tempDir: string

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(os.tmpdir())
    const dbPath = `${tempDir}/test.db`
    db = new Database(dbPath)
    await db.init()
    repo = new SessionsRepo(db)
  })

  afterEach(async () => {
    await db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should create a new session', () => {
    repo.create({
      id: 'session-1',
      project: 'test-project',
      project_path: '/path/to/project',
      started_at: '2025-01-15T10:00:00Z',
    })

    const session = repo.getById('session-1')
    expect(session).toBeDefined()
    expect(session?.id).toBe('session-1')
    expect(session?.project).toBe('test-project')
    expect(session?.project_path).toBe('/path/to/project')
    expect(session?.started_at).toBe('2025-01-15T10:00:00Z')
  })

  it('should create session without optional fields', () => {
    repo.create({
      id: 'session-2',
      project: 'minimal-project',
      started_at: '2025-01-15T11:00:00Z',
    })

    const session = repo.getById('session-2')
    expect(session).toBeDefined()
    expect(session?.project_path).toBeNull()
  })

  it('should return undefined for non-existent session', () => {
    const session = repo.getById('non-existent')
    expect(session).toBeUndefined()
  })

  it('should update session fields', () => {
    repo.create({
      id: 'session-3',
      project: 'test-project',
      started_at: '2025-01-15T10:00:00Z',
    })

    repo.update('session-3', {
      ended_at: '2025-01-15T12:00:00Z',
      summary: 'Test session completed',
      discovery_tokens: 1500,
    })

    const session = repo.getById('session-3')
    expect(session?.ended_at).toBe('2025-01-15T12:00:00Z')
    expect(session?.summary).toBe('Test session completed')
    expect(session?.discovery_tokens).toBe(1500)
  })

  it('should update only provided fields', () => {
    repo.create({
      id: 'session-4',
      project: 'test-project',
      started_at: '2025-01-15T10:00:00Z',
    })

    repo.update('session-4', { summary: 'Partial update' })

    const session = repo.getById('session-4')
    expect(session?.summary).toBe('Partial update')
    expect(session?.ended_at).toBeNull()
    expect(session?.discovery_tokens).toBe(0)
  })

  it('should handle empty update gracefully', () => {
    repo.create({
      id: 'session-5',
      project: 'test-project',
      started_at: '2025-01-15T10:00:00Z',
    })

    // Should not throw
    repo.update('session-5', {})

    const session = repo.getById('session-5')
    expect(session).toBeDefined()
  })

  it('should get latest session by project', () => {
    const now = '2025-01-15T10:00:00Z'
    const later = '2025-01-15T12:00:00Z'
    const latest = '2025-01-15T14:00:00Z'

    repo.create({ id: 'session-1', project: 'project-a', started_at: now })
    repo.create({ id: 'session-2', project: 'project-a', started_at: later })
    repo.create({ id: 'session-3', project: 'project-a', started_at: latest })
    repo.create({ id: 'session-4', project: 'project-b', started_at: later })

    const latestA = repo.getLatestByProject('project-a')
    expect(latestA?.id).toBe('session-3')

    const latestB = repo.getLatestByProject('project-b')
    expect(latestB?.id).toBe('session-4')
  })

  it('should return undefined for latest session in non-existent project', () => {
    const latest = repo.getLatestByProject('non-existent-project')
    expect(latest).toBeUndefined()
  })

  it('should handle multiple sessions for same project', () => {
    for (let i = 0; i < 5; i++) {
      repo.create({
        id: `session-${i}`,
        project: 'multi-session-project',
        started_at: `2025-01-15T${10 + i}:00:00Z`,
      })
    }

    const latest = repo.getLatestByProject('multi-session-project')
    expect(latest?.id).toBe('session-4')
  })

  it('should persist changes to database', () => {
    repo.create({
      id: 'persist-test',
      project: 'test-project',
      started_at: '2025-01-15T10:00:00Z',
    })

    repo.update('persist-test', { summary: 'Should persist' })

    // Create new repo instance to verify persistence
    const repo2 = new SessionsRepo(db)
    const session = repo2.getById('persist-test')
    expect(session?.summary).toBe('Should persist')
  })
})
