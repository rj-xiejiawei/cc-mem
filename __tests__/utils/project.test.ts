import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectProject } from '../../src/utils/project.js'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

describe('detectProject', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(os.tmpdir())
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should return explicit name when provided', () => {
    const result = detectProject('/any/path', 'my-custom-project')
    expect(result).toBe('my-custom-project')
  })

  it('should detect git repo name', () => {
    // Create a temp git repo
    const projectDir = `${tempDir}/test-project`
    fs.mkdirSync(projectDir, { recursive: true })
    execSync('git init', { cwd: projectDir, stdio: 'pipe' })

    const result = detectProject(projectDir)
    expect(result).toBe('test-project')
  })

  it('should fall back to basename for non-git directory', () => {
    const dirName = 'my-directory'
    const projectDir = `${tempDir}/${dirName}`
    fs.mkdirSync(projectDir, { recursive: true })

    const result = detectProject(projectDir)
    expect(result).toBe(dirName)
  })

  it('should handle nested paths in git repo', () => {
    const projectDir = `${tempDir}/test-project`
    fs.mkdirSync(projectDir, { recursive: true })
    execSync('git init', { cwd: projectDir, stdio: 'pipe' })

    const nestedDir = `${projectDir}/src/components`
    fs.mkdirSync(nestedDir, { recursive: true })

    const result = detectProject(nestedDir)
    expect(result).toBe('test-project')
  })

  it('should handle paths with special characters', () => {
    const dirName = 'test-project-123'
    const projectDir = `${tempDir}/${dirName}`
    fs.mkdirSync(projectDir, { recursive: true })

    const result = detectProject(projectDir)
    expect(result).toBe(dirName)
  })
})
