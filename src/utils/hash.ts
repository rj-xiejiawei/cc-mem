import { createHash } from 'node:crypto'

export function contentHash(title: string, narrative: string): string {
  return createHash('sha256').update(title + narrative).digest('hex')
}
