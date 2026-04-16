import { describe, it, expect } from 'vitest'
import { contentHash } from '../../src/utils/hash.js'

describe('contentHash', () => {
  it('should generate consistent hash for same input', () => {
    const title = 'Test Title'
    const narrative = 'Test narrative content'
    const hash1 = contentHash(title, narrative)
    const hash2 = contentHash(title, narrative)
    expect(hash1).toBe(hash2)
  })

  it('should generate different hashes for different inputs', () => {
    const hash1 = contentHash('Title A', 'Narrative A')
    const hash2 = contentHash('Title B', 'Narrative B')
    expect(hash1).not.toBe(hash2)
  })

  it('should return hex string of 64 characters', () => {
    const hash = contentHash('Title', 'Narrative')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should handle empty strings', () => {
    const hash = contentHash('', '')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should handle special characters', () => {
    const hash = contentHash('标题 🎯', 'Narrative with emoji 🚀\nNew line')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should be case-sensitive', () => {
    const hash1 = contentHash('title', 'narrative')
    const hash2 = contentHash('TITLE', 'NARRATIVE')
    expect(hash1).not.toBe(hash2)
  })
})
