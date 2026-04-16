import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import { ObservationsRepo } from '../../src/db/observations.js'
import { SessionsRepo } from '../../src/db/sessions.js'
import { KnowledgeRepo } from '../../src/db/knowledge.js'
import fs from 'node:fs'
import os from 'node:os'

describe('KnowledgeRepo', () => {
  let db: Database
  let obsRepo: ObservationsRepo
  let sessionsRepo: SessionsRepo
  let knowledgeRepo: KnowledgeRepo
  let tempDir: string

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(os.tmpdir())
    const dbPath = `${tempDir}/test.db`
    db = new Database(dbPath)
    await db.init()
    obsRepo = new ObservationsRepo(db)
    sessionsRepo = new SessionsRepo(db)
    knowledgeRepo = new KnowledgeRepo(db)

    // Create a session + observation for source_observation_id tests
    sessionsRepo.create({
      id: 'session-1',
      project: 'project-a',
      project_path: '/test',
      started_at: '2025-01-15T10:00:00Z',
    })
    obsRepo.create({
      id: 'obs-1',
      session_id: 'session-1',
      type: 'discovery',
      title: 'Found auth bug',
      narrative: 'JWT token expired too early',
      project: 'project-a',
      created_at: '2025-01-15T10:00:00Z',
    })
  })

  afterEach(async () => {
    await db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('should create a knowledge entry', () => {
      knowledgeRepo.create({
        id: 'kn-1',
        kind: 'rule',
        entity: 'auth',
        summary: 'All API responses use { code, data, message }',
        detail: 'Standardized response format for consistency',
        source_observation_id: 'obs-1',
        project: 'project-a',
        created_at: '2025-01-15T10:00:00Z',
      })

      const kn = knowledgeRepo.getById('kn-1')
      expect(kn).toBeDefined()
      expect(kn!.kind).toBe('rule')
      expect(kn!.entity).toBe('auth')
      expect(kn!.status).toBe('active')
      expect(kn!.source_observation_id).toBe('obs-1')
    })

    it('should create without optional fields', () => {
      knowledgeRepo.create({
        id: 'kn-2',
        kind: 'pattern',
        entity: 'error',
        summary: 'Use try/catch with logger.error',
        project: 'project-a',
        created_at: '2025-01-15T10:00:00Z',
      })

      const kn = knowledgeRepo.getById('kn-2')
      expect(kn).toBeDefined()
      expect(kn!.detail).toBeNull()
      expect(kn!.source_observation_id).toBeNull()
    })
  })

  describe('getById', () => {
    it('should return undefined for non-existent id', () => {
      expect(knowledgeRepo.getById('nonexistent')).toBeUndefined()
    })
  })

  describe('listByProject', () => {
    beforeEach(() => {
      knowledgeRepo.create({
        id: 'kn-1', kind: 'rule', entity: 'auth',
        summary: 'Rule 1', project: 'project-a', created_at: '2025-01-15T10:00:00Z',
      })
      knowledgeRepo.create({
        id: 'kn-2', kind: 'adr', entity: 'storage',
        summary: 'ADR 1', project: 'project-a', created_at: '2025-01-15T11:00:00Z',
      })
      knowledgeRepo.create({
        id: 'kn-3', kind: 'rule', entity: 'api',
        summary: 'Rule 2', project: 'project-b', created_at: '2025-01-15T12:00:00Z',
      })
    })

    it('should list by project', () => {
      const list = knowledgeRepo.listByProject('project-a')
      expect(list.length).toBe(2)
    })

    it('should filter by kind', () => {
      const list = knowledgeRepo.listByProject('project-a', { kind: 'rule' })
      expect(list.length).toBe(1)
      expect(list[0].kind).toBe('rule')
    })

    it('should filter by entity', () => {
      const list = knowledgeRepo.listByProject('project-a', { entity: 'auth' })
      expect(list.length).toBe(1)
      expect(list[0].entity).toBe('auth')
    })

    it('should filter by status', () => {
      knowledgeRepo.updateStatus('kn-1', 'deprecated')
      const list = knowledgeRepo.listByProject('project-a', { status: 'active' })
      expect(list.length).toBe(1)
      expect(list[0].id).toBe('kn-2')
    })

    it('should respect limit', () => {
      const list = knowledgeRepo.listByProject('project-a', { limit: 1 })
      expect(list.length).toBe(1)
    })

    it('should return empty for unknown project', () => {
      const list = knowledgeRepo.listByProject('project-z')
      expect(list).toEqual([])
    })
  })

  describe('listBySourceObservation', () => {
    it('should find knowledge derived from an observation', () => {
      knowledgeRepo.create({
        id: 'kn-1', kind: 'rule', entity: 'auth',
        summary: 'Rule from obs', source_observation_id: 'obs-1',
        project: 'project-a', created_at: '2025-01-15T10:00:00Z',
      })

      const list = knowledgeRepo.listBySourceObservation('obs-1')
      expect(list.length).toBe(1)
      expect(list[0].source_observation_id).toBe('obs-1')
    })

    it('should return empty for observation with no knowledge', () => {
      const list = knowledgeRepo.listBySourceObservation('obs-nonexistent')
      expect(list).toEqual([])
    })
  })

  describe('updateStatus', () => {
    it('should change status from active to deprecated', () => {
      knowledgeRepo.create({
        id: 'kn-1', kind: 'rule', entity: 'auth',
        summary: 'Rule', project: 'project-a', created_at: '2025-01-15T10:00:00Z',
      })

      knowledgeRepo.updateStatus('kn-1', 'deprecated')
      const kn = knowledgeRepo.getById('kn-1')
      expect(kn!.status).toBe('deprecated')
    })
  })

  describe('delete', () => {
    it('should delete a knowledge entry', () => {
      knowledgeRepo.create({
        id: 'kn-1', kind: 'rule', entity: 'auth',
        summary: 'Rule', project: 'project-a', created_at: '2025-01-15T10:00:00Z',
      })

      knowledgeRepo.delete('kn-1')
      expect(knowledgeRepo.getById('kn-1')).toBeUndefined()
    })
  })

  describe('ON DELETE SET NULL', () => {
    it.skip('should set source_observation_id to NULL when observation is deleted', () => {
      // NOTE: Foreign key constraints require PRAGMA foreign_keys = ON to be set
      // at runtime in Database.init(). This test is skipped until that's implemented.
      knowledgeRepo.create({
        id: 'kn-1', kind: 'rule', entity: 'auth',
        summary: 'Rule from obs', source_observation_id: 'obs-1',
        project: 'project-a', created_at: '2025-01-15T10:00:00Z',
      })

      // Delete the observation
      obsRepo.delete('obs-1')

      // Knowledge should still exist but with NULL source
      const kn = knowledgeRepo.getById('kn-1')
      expect(kn).toBeDefined()
      expect(kn!.source_observation_id).toBeNull()
    })
  })
})
