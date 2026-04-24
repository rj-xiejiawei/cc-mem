import { describe, it, expect } from 'vitest'
import { helloWorld } from '../../src/tools/hello-world.js'

describe('helloWorld', () => {
  it('should greet the world when no name is provided', async () => {
    const result = await helloWorld({})
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBe('Hello, World! This is cc-mem speaking.')
  })

  it('should greet a specific name when provided', async () => {
    const result = await helloWorld({ name: 'Claude' })
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBe('Hello, Claude! This is cc-mem speaking.')
  })

  it('should handle empty string name by defaulting to World', async () => {
    const result = await helloWorld({ name: '' })
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBe('Hello, World! This is cc-mem speaking.')
  })

  it('should handle names with special characters', async () => {
    const result = await helloWorld({ name: '日本語' })
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBe('Hello, 日本語! This is cc-mem speaking.')
  })
})
