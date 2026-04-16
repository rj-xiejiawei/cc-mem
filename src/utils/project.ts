import { execSync } from 'node:child_process'
import path from 'node:path'

export function detectProject(cwd: string, explicit?: string): string {
  if (explicit) return explicit

  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
    return path.basename(gitRoot)
  } catch {
    return path.basename(cwd)
  }
}
