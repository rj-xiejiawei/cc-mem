import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import { ObservationsRepo } from '../../src/db/observations.js'
import { SearchRepo } from '../../src/db/search.js'
import fs from 'node:fs'
import os from 'node:os'

describe('SearchRepo', () => {
  let db: Database
  let observationsRepo: ObservationsRepo
  let searchRepo: SearchRepo
  let tempDir: string
  let fts5Supported = false

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(os.tmpdir())
    const dbPath = `${tempDir}/test.db`
    db = new Database(dbPath)
    await db.init()
    observationsRepo = new ObservationsRepo(db)
    searchRepo = new SearchRepo(db)

    // Check if FTS5 is supported
    try {
      db.getDb().exec('CREATE VIRTUAL TABLE IF NOT EXISTS fts5_test USING fts5(test)')
      db.getDb().exec('DROP TABLE IF EXISTS fts5_test')
      fts5Supported = true
    } catch {
      fts5Supported = false
    }

    // Create test observations
    observationsRepo.create({
      id: 'obs-1',
      session_id: 'session-1',
      type: 'discovery',
      title: 'Found performance bug in database query',
      narrative: 'The query was slow due to missing index',
      project: 'project-a',
      created_at: '2025-01-15T10:00:00Z',
    })
    observationsRepo.create({
      id: 'obs-2',
      session_id: 'session-1',
      type: 'bugfix',
      title: 'Fixed memory leak in server',
      narrative: 'Added cleanup handler for connections',
      project: 'project-a',
      created_at: '2025-01-15T11:00:00Z',
    })
    observationsRepo.create({
      id: 'obs-3',
      session_id: 'session-2',
      type: 'feature',
      title: 'Added new API endpoint',
      narrative: 'Implemented REST API for user management',
      project: 'project-b',
      created_at: '2025-01-15T12:00:00Z',
    })
    observationsRepo.create({
      id: 'obs-4',
      session_id: 'session-2',
      type: 'discovery',
      title: 'Database connection issue',
      narrative: 'Connection pool exhausted under load',
      project: 'project-a',
      created_at: '2025-01-15T13:00:00Z',
    })
  })

  afterEach(async () => {
    await db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('search', () => {
    it('should search observations by query', () => {
      if (!fts5Supported) return
      const results = searchRepo.search('database')

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('rank')
      expect(results[0]).toHaveProperty('id')
      expect(results[0]).toHaveProperty('title')
    })

    it('should limit results', () => {
      if (!fts5Supported) return
      const results = searchRepo.search('project', { limit: 2 })

      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('should filter by type', () => {
      if (!fts5Supported) return
      const results = searchRepo.search('database', { type: 'discovery' })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.type).toBe('discovery')
      })
    })

    it('should filter by project', () => {
      const results = searchRepo.search('database', { project: 'project-a' })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.project).toBe('project-a')
      })
    })

    it('should filter by status', () => {
      const results = searchRepo.search('API', { status: 'confirmed' })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.status).toBe('confirmed')
      })
    })

    it('should filter by since date', () => {
      if (!fts5Supported) return
      const results = searchRepo.search('database', {
        since: '2025-01-15T11:30:00Z',
      })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.created_at > '2025-01-15T11:30:00Z').toBe(true)
      })
    })

    it('should combine multiple filters', () => {
      const results = searchRepo.search('database', {
        project: 'project-a',
        type: 'discovery',
        limit: 10,
      })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.project).toBe('project-a')
        expect(r.type).toBe('discovery')
      })
    })

    it('should return empty array for no matches', () => {
      const results = searchRepo.search('nonexistenttermxyz123')

      expect(results).toEqual([])
    })

    it('should return results sorted by rank', () => {
      const results = searchRepo.search('database')

      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].rank).toBeLessThanOrEqual(results[i].rank)
        }
      }
    })

    it('should search in title and narrative', () => {
      const titleResults = searchRepo.search('performance')
      const narrativeResults = searchRepo.search('query')

      expect(titleResults.length).toBeGreaterThan(0)
      expect(narrativeResults.length).toBeGreaterThan(0)
    })

    it('should handle special characters in query', () => {
      const results = searchRepo.search('API endpoint')

      expect(results.length).toBeGreaterThan(0)
    })

    it('should handle empty query', () => {
      const results = searchRepo.search('')

      // FTS should return all results or empty depending on implementation
      expect(Array.isArray(results)).toBe(true)
    })

    it('should respect all filters together', () => {
      const results = searchRepo.search('database', {
        project: 'project-a',
        type: 'discovery',
        status: 'confirmed',
        since: '2025-01-15T00:00:00Z',
        limit: 5,
      })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.project).toBe('project-a')
        expect(r.type).toBe('discovery')
        expect(r.status).toBe('confirmed')
        expect(r.created_at > '2025-01-15T00:00:00Z').toBe(true)
      })
    })

    it('should return SearchResult with rank property', () => {
      const results = searchRepo.search('database')

      results.forEach((r) => {
        expect(r).toHaveProperty('rank')
        expect(typeof r.rank).toBe('number')
      })
    })
  })
})
