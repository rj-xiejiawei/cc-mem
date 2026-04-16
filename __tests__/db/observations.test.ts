import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Database } from '../../src/db/database.js'
import { ObservationsRepo } from '../../src/db/observations.js'
import fs from 'node:fs'
import os from 'node:os'

describe('ObservationsRepo', () => {
  let db: Database
  let repo: ObservationsRepo
  let tempDir: string

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(os.tmpdir())
    const dbPath = `${tempDir}/test.db`
    db = new Database(dbPath)
    await db.init()
    repo = new ObservationsRepo(db)
  })

  afterEach(async () => {
    await db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('should create a new observation', () => {
      const result = repo.create({
        id: 'obs-1',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Found bug',
        narrative: 'Fixed memory leak in server',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 500,
      })

      expect(result).toBe('created')

      const obs = repo.getById('obs-1')
      expect(obs).toBeDefined()
      expect(obs?.title).toBe('Found bug')
      expect(obs?.content_hash).toBeDefined()
    })

    it('should detect duplicate within 30 seconds', () => {
      const now = new Date().toISOString()
      const baseInput = {
        id: 'obs-2',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Duplicate Test',
        narrative: 'Same content',
        project: 'test-project',
        created_at: now,
      }

      const result1 = repo.create(baseInput)
      expect(result1).toBe('created')

      const result2 = repo.create({ ...baseInput, id: 'obs-3' })
      expect(result2).toBe('duplicate')
    })

    it('should not detect duplicate after 30 seconds', () => {
      const baseInput = {
        id: 'obs-4',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Old Duplicate Test',
        narrative: 'Old content',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
      }

      repo.create(baseInput)

      // Create observation with same content but created_at more than 30 seconds ago
      const result2 = repo.create({
        ...baseInput,
        id: 'obs-5',
        created_at: '2025-01-15T10:00:31Z', // 31 seconds later
      })
      expect(result2).toBe('created')
    })

    it('should not detect duplicate without narrative', () => {
      const result1 = repo.create({
        id: 'obs-6',
        session_id: 'session-1',
        type: 'discovery',
        title: 'No Narrative',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
      })
      expect(result1).toBe('created')

      const result2 = repo.create({
        id: 'obs-7',
        session_id: 'session-1',
        type: 'discovery',
        title: 'No Narrative',
        project: 'test-project',
        created_at: '2025-01-15T10:00:01Z',
      })
      expect(result2).toBe('created')
    })

    it('should not detect duplicate across different sessions', () => {
      const baseInput = {
        type: 'discovery',
        title: 'Cross Session',
        narrative: 'Same content',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
      }

      repo.create({ ...baseInput, id: 'obs-8', session_id: 'session-1' })
      const result2 = repo.create({ ...baseInput, id: 'obs-9', session_id: 'session-2' })

      expect(result2).toBe('created')
    })

    it('should handle all optional fields', () => {
      const result = repo.create({
        id: 'obs-10',
        session_id: 'session-1',
        type: 'feature',
        title: 'Full Observation',
        narrative: 'Complete narrative',
        facts: '["fact1", "fact2"]',
        concepts: '["architecture", "api"]',
        files_read: '["src/main.ts"]',
        files_modified: '["src/utils.ts"]',
        project: 'test-project',
        prompt_number: 5,
        status: 'pending',
        created_at: '2025-01-15T10:00:00Z',
        discovery_tokens: 1000,
      })

      expect(result).toBe('created')

      const obs = repo.getById('obs-10')
      expect(obs?.facts).toBe('["fact1", "fact2"]')
      expect(obs?.concepts).toBe('["architecture", "api"]')
      expect(obs?.files_read).toBe('["src/main.ts"]')
      expect(obs?.files_modified).toBe('["src/utils.ts"]')
      expect(obs?.prompt_number).toBe(5)
      expect(obs?.status).toBe('pending')
    })
  })

  describe('getById', () => {
    it('should return undefined for non-existent observation', () => {
      const obs = repo.getById('non-existent')
      expect(obs).toBeUndefined()
    })

    it('should retrieve observation by id', () => {
      repo.create({
        id: 'obs-11',
        session_id: 'session-1',
        type: 'bugfix',
        title: 'Get Test',
        narrative: 'Test getById',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
      })

      const obs = repo.getById('obs-11')
      expect(obs?.id).toBe('obs-11')
      expect(obs?.title).toBe('Get Test')
    })
  })

  describe('listByProject', () => {
    beforeEach(() => {
      const now = '2025-01-15T10:00:00Z'
      repo.create({
        id: 'obs-1',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Obs 1',
        narrative: 'First',
        project: 'project-a',
        created_at: now,
      })
      repo.create({
        id: 'obs-2',
        session_id: 'session-1',
        type: 'bugfix',
        title: 'Obs 2',
        narrative: 'Second',
        project: 'project-a',
        created_at: '2025-01-15T11:00:00Z',
      })
      repo.create({
        id: 'obs-3',
        session_id: 'session-2',
        type: 'feature',
        title: 'Obs 3',
        narrative: 'Third',
        project: 'project-b',
        created_at: '2025-01-15T12:00:00Z',
      })
    })

    it('should list observations by project', () => {
      const observations = repo.listByProject('project-a', 10)
      expect(observations).toHaveLength(2)
      expect(observations[0].id).toBe('obs-2') // Most recent first
      expect(observations[1].id).toBe('obs-1')
    })

    it('should respect limit', () => {
      const observations = repo.listByProject('project-a', 1)
      expect(observations).toHaveLength(1)
      expect(observations[0].id).toBe('obs-2')
    })

    it('should return empty array for project with no observations', () => {
      const observations = repo.listByProject('non-existent', 10)
      expect(observations).toEqual([])
    })
  })

  describe('listBySession', () => {
    beforeEach(() => {
      repo.create({
        id: 'obs-1',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Session 1 Obs 1',
        narrative: 'First',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
      })
      repo.create({
        id: 'obs-2',
        session_id: 'session-1',
        type: 'bugfix',
        title: 'Session 1 Obs 2',
        narrative: 'Second',
        project: 'test-project',
        created_at: '2025-01-15T11:00:00Z',
      })
      repo.create({
        id: 'obs-3',
        session_id: 'session-2',
        type: 'feature',
        title: 'Session 2 Obs',
        narrative: 'Third',
        project: 'test-project',
        created_at: '2025-01-15T12:00:00Z',
      })
    })

    it('should list observations by session', () => {
      const observations = repo.listBySession('session-1')
      expect(observations).toHaveLength(2)
      expect(observations[0].id).toBe('obs-1')
      expect(observations[1].id).toBe('obs-2')
    })

    it('should return empty array for non-existent session', () => {
      const observations = repo.listBySession('non-existent')
      expect(observations).toEqual([])
    })
  })

  describe('updateStatus', () => {
    it('should update status and reviewed_at', () => {
      repo.create({
        id: 'obs-12',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Status Test',
        narrative: 'Test status update',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
      })

      repo.updateStatus('obs-12', 'approved')

      const obs = repo.getById('obs-12')
      expect(obs?.status).toBe('approved')
      expect(obs?.reviewed_at).toBeDefined()
    })
  })

  describe('delete', () => {
    it('should delete observation', () => {
      repo.create({
        id: 'obs-13',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Delete Test',
        narrative: 'Will be deleted',
        project: 'test-project',
        created_at: '2025-01-15T10:00:00Z',
      })

      repo.delete('obs-13')

      const obs = repo.getById('obs-13')
      expect(obs).toBeUndefined()
    })

    it('should handle deleting non-existent observation', () => {
      // Should not throw
      expect(() => repo.delete('non-existent')).not.toThrow()
    })
  })

  describe('listProjects', () => {
    beforeEach(() => {
      repo.create({
        id: 'obs-1',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Project A Obs 1',
        narrative: 'First',
        project: 'project-a',
        created_at: '2025-01-15T10:00:00Z',
      })
      repo.create({
        id: 'obs-2',
        session_id: 'session-1',
        type: 'bugfix',
        title: 'Project A Obs 2',
        narrative: 'Second',
        project: 'project-a',
        created_at: '2025-01-15T11:00:00Z',
      })
      repo.create({
        id: 'obs-3',
        session_id: 'session-2',
        type: 'feature',
        title: 'Project B Obs',
        narrative: 'Third',
        project: 'project-b',
        created_at: '2025-01-15T09:00:00Z',
      })
    })

    it('should list projects with counts and last activity', () => {
      const projects = repo.listProjects()

      expect(projects).toHaveLength(2)
      expect(projects[0].project).toBe('project-a') // Most recent first
      expect(projects[0].count).toBe(2)
      expect(projects[0].last_activity).toBe('2025-01-15T11:00:00Z')

      expect(projects[1].project).toBe('project-b')
      expect(projects[1].count).toBe(1)
      expect(projects[1].last_activity).toBe('2025-01-15T09:00:00Z')
    })

    it('should return empty array when no observations', async () => {
      const emptyDb = new Database(`${tempDir}/empty.db`)
      await emptyDb.init()
      const emptyRepo = new ObservationsRepo(emptyDb)

      const projects = emptyRepo.listProjects()
      expect(projects).toEqual([])

      await emptyDb.close()
    })
  })
})
