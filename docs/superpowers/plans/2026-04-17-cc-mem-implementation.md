# cc-mem Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working MCP server that stores, searches, and retrieves cross-session memory for AI coding assistants, with Zhipu API as the default LLM provider.

**Architecture:** MCP server (stdio) backed by sql.js (WASM SQLite) + FTS5. LLMProvider interface with ZhipuProvider as default. All capabilities exposed as MCP tools/resources — no IDE hooks, no background worker.

**Tech Stack:** TypeScript, Node.js, sql.js, @modelcontextprotocol/sdk, uuid (v7)

**Spec:** `docs/superpowers/specs/2026-04-17-cc-mem-design.md`

---

## File Structure

```
cc-mem/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # CLI entry point
│   ├── server.ts                   # MCP server setup
│   ├── db/
│   │   ├── database.ts             # sql.js lifecycle + helpers
│   │   ├── migrations.ts           # Schema versioning + migration runner
│   │   ├── observations.ts         # observations CRUD + dedup
│   │   ├── sessions.ts             # sessions CRUD
│   │   └── search.ts               # FTS5 search
│   ├── llm/
│   │   ├── provider.ts             # LLMProvider interface
│   │   └── providers/
│   │       └── zhipu.ts            # Zhipu API implementation
│   ├── tools/
│   │   ├── add-observation.ts
│   │   ├── search.ts
│   │   ├── get-context.ts
│   │   ├── summarize.ts
│   │   ├── review-observation.ts
│   │   ├── list-projects.ts
│   │   └── delete-observation.ts
│   ├── resources/
│   │   ├── context.ts              # cc-mem://context/{project}
│   │   └── session.ts              # cc-mem://session/{session_id}
│   ├── prompts/
│   │   └── usage-guide.ts          # cc-mem://prompts/usage-guide
│   └── utils/
│       ├── hash.ts                 # SHA256 content hash
│       ├── format.ts               # Markdown context formatting
│       └── project.ts              # Project name detection
├── __tests__/
│   ├── db/
│   │   ├── database.test.ts
│   │   ├── observations.test.ts
│   │   ├── sessions.test.ts
│   │   └── search.test.ts
│   ├── llm/
│   │   └── zhipu.test.ts
│   ├── tools/
│   │   └── integration.test.ts
│   └── utils/
│       ├── hash.test.ts
│       └── format.test.ts
└── docs/
    └── ...
```

---

## Chunk 1: Project Setup + Database Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Initialize project**

```bash
cd /Users/xielaoban/Documents/GitHub/cc-mem
npm init -y
```

- [ ] **Step 2: Configure package.json**

Set `name`, `bin`, `type: "module"`, `main`, `scripts`:
```json
{
  "name": "cc-mem",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "cc-mem": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --experimental-vm-modules node_modules/.bin/vitest run",
    "test:watch": "node --experimental-vm-modules node_modules/.bin/vitest",
    "prepublishOnly": "npm run build"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install sql.js @modelcontextprotocol/sdk uuid
npm install -D typescript @types/node @types/uuid vitest
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json package-lock.json
git commit -m "chore: project scaffolding with TypeScript + sql.js + MCP SDK"
```

### Task 2: Database Connection + Migrations

**Files:**
- Create: `src/db/database.ts`
- Create: `src/db/migrations.ts`
- Create: `__tests__/db/database.test.ts`

- [ ] **Step 1: Write failing test for database initialization**

`__tests__/db/database.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('Database', () => {
  let db: Database
  const dbPath = path.join(os.tmpdir(), `cc-mem-test-${Date.now()}.db`)

  afterEach(async () => {
    if (db) await db.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('should initialize and create tables', async () => {
    db = new Database(dbPath)
    await db.init()
    const result = db.getDb().exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    const tableNames = result.map(r => r.values.flat()).flat()
    expect(tableNames).toContain('sessions')
    expect(tableNames).toContain('observations')
    expect(tableNames).toContain('observations_fts')
    expect(tableNames).toContain('user_prompts')
    expect(tableNames).toContain('schema_versions')
  })

  it('should persist to disk', async () => {
    db = new Database(dbPath)
    await db.init()
    await db.close()
    expect(fs.existsSync(dbPath)).toBe(true)
  })

  it('should handle corrupted db file by recreating', async () => {
    fs.writeFileSync(dbPath, 'not a valid db')
    db = new Database(dbPath)
    await db.init()
    const result = db.getDb().exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    expect(result.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- __tests__/db/database.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement Database class**

`src/db/database.ts`:
```typescript
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'
import { runMigrations } from './migrations.js'

export class Database {
  private db: SqlJsDatabase | null = null
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  async init(): Promise<void> {
    const SQL = await initSqlJs()
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath)
      try {
        this.db = new SQL.Database(buffer)
      } catch {
        // Corrupted file — backup and recreate
        fs.renameSync(this.dbPath, this.dbPath + '.bak')
        this.db = new SQL.Database()
      }
    } else {
      this.db = new SQL.Database()
    }

    runMigrations(this.db)
    this.persist()
  }

  getDb(): SqlJsDatabase {
    if (!this.db) throw new Error('Database not initialized')
    return this.db
  }

  persist(): void {
    if (!this.db) return
    const data = this.db.export()
    fs.writeFileSync(this.dbPath, Buffer.from(data))
  }

  async close(): Promise<void> {
    if (this.db) {
      this.persist()
      this.db.close()
      this.db = null
    }
  }
}
```

- [ ] **Step 4: Implement migrations**

`src/db/migrations.ts`:
```typescript
import { Database as SqlJsDatabase } from 'sql.js'

const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      project_path TEXT,
      started_at TEXT,
      ended_at TEXT,
      summary TEXT,
      discovery_tokens INTEGER DEFAULT 0
    )`,
    `CREATE TABLE observations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      narrative TEXT,
      facts TEXT,
      concepts TEXT,
      files_read TEXT,
      files_modified TEXT,
      project TEXT NOT NULL,
      content_hash TEXT,
      prompt_number INTEGER,
      status TEXT NOT NULL DEFAULT 'confirmed',
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      discovery_tokens INTEGER DEFAULT 0
    )`,
    `CREATE INDEX idx_observations_project ON observations(project)`,
    `CREATE INDEX idx_observations_session ON observations(session_id)`,
    `CREATE INDEX idx_observations_created ON observations(created_at)`,
    `CREATE INDEX idx_observations_type ON observations(type)`,
    `CREATE INDEX idx_observations_status ON observations(status)`,
    `CREATE INDEX idx_observations_hash ON observations(content_hash)`,
    `CREATE INDEX idx_sessions_project ON sessions(project)`,
    `CREATE VIRTUAL TABLE observations_fts USING fts5(title, narrative, facts, concepts)`,
    `CREATE TRIGGER observations_fts_insert AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
      VALUES (NEW.rowid, NEW.title, NEW.narrative, NEW.facts, NEW.concepts);
    END`,
    `CREATE TRIGGER observations_fts_update AFTER UPDATE ON observations BEGIN
      DELETE FROM observations_fts WHERE rowid = OLD.rowid;
      INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
      VALUES (NEW.rowid, NEW.title, NEW.narrative, NEW.facts, NEW.concepts);
    END`,
    `CREATE TRIGGER observations_fts_delete AFTER DELETE ON observations BEGIN
      DELETE FROM observations_fts WHERE rowid = OLD.rowid;
    END`,
    `CREATE TABLE user_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id),
      content TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  ],
}

export function runMigrations(db: SqlJsDatabase): void {
  // Get current version
  let currentVersion = 0
  try {
    const result = db.exec('SELECT MAX(version) FROM schema_versions')
    if (result[0]?.values[0]?.[0]) {
      currentVersion = result[0].values[0][0] as number
    }
  } catch {
    // Table doesn't exist yet, version is 0
  }

  for (const [version, statements] of Object.entries(MIGRATIONS)) {
    const v = Number(version)
    if (v > currentVersion) {
      for (const sql of statements) {
        db.run(sql)
      }
      db.run('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)',
        [v, new Date().toISOString()])
    }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- __tests__/db/database.test.ts
```
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/ __tests__/db/
git commit -m "feat: database layer with sql.js + migrations + FTS5"
```

### Task 3: Sessions CRUD

**Files:**
- Create: `src/db/sessions.ts`
- Create: `__tests__/db/sessions.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/db/sessions.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import { SessionsRepo } from '../../src/db/sessions.js'
import { v7 as uuidv7 } from 'uuid'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('SessionsRepo', () => {
  let db: Database
  let repo: SessionsRepo
  const dbPath = path.join(os.tmpdir(), `cc-mem-test-${Date.now()}.db`)

  beforeEach(async () => {
    db = new Database(dbPath)
    await db.init()
    repo = new SessionsRepo(db)
  })

  afterEach(async () => {
    await db.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('should create a session', () => {
    const id = uuidv7()
    repo.create({ id, project: 'test-project', project_path: '/tmp/test', started_at: new Date().toISOString() })
    const session = repo.getById(id)
    expect(session).toBeDefined()
    expect(session!.project).toBe('test-project')
  })

  it('should update session end time and summary', () => {
    const id = uuidv7()
    repo.create({ id, project: 'test', started_at: new Date().toISOString() })
    const summary = JSON.stringify({ request: 'test', completed: ['did stuff'] })
    repo.update(id, { ended_at: new Date().toISOString(), summary })
    const session = repo.getById(id)
    expect(session!.ended_at).toBeDefined()
    expect(session!.summary).toBe(summary)
  })

  it('should get latest session by project', () => {
    const now = Date.now()
    repo.create({ id: uuidv7(), project: 'proj', started_at: new Date(now - 1000).toISOString() })
    const latestId = uuidv7()
    repo.create({ id: latestId, project: 'proj', started_at: new Date(now).toISOString() })
    const latest = repo.getLatestByProject('proj')
    expect(latest).toBeDefined()
    expect(latest!.id).toBe(latestId)
  })

  it('should return undefined for nonexistent session', () => {
    expect(repo.getById('nonexistent')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- __tests__/db/sessions.test.ts
```

- [ ] **Step 3: Implement SessionsRepo**

`src/db/sessions.ts`:
```typescript
import { Database } from './database.js'

export interface Session {
  id: string
  project: string
  project_path: string | null
  started_at: string
  ended_at: string | null
  summary: string | null
  discovery_tokens: number
}

interface CreateSessionInput {
  id: string
  project: string
  project_path?: string
  started_at: string
}

interface UpdateSessionInput {
  ended_at?: string
  summary?: string
  discovery_tokens?: number
}

export class SessionsRepo {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateSessionInput): void {
    this.db.getDb().run(
      'INSERT INTO sessions (id, project, project_path, started_at) VALUES (?, ?, ?, ?)',
      [input.id, input.project, input.project_path ?? null, input.started_at]
    )
    this.db.persist()
  }

  getById(id: string): Session | undefined {
    const result = this.db.getDb().exec('SELECT * FROM sessions WHERE id = ?', [id])
    if (!result[0]?.values[0]) return undefined
    return this.mapRow(result[0].columns, result[0].values[0])
  }

  update(id: string, input: UpdateSessionInput): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (input.ended_at !== undefined) { sets.push('ended_at = ?'); values.push(input.ended_at) }
    if (input.summary !== undefined) { sets.push('summary = ?'); values.push(input.summary) }
    if (input.discovery_tokens !== undefined) { sets.push('discovery_tokens = ?'); values.push(input.discovery_tokens) }
    if (sets.length === 0) return
    values.push(id)
    this.db.getDb().run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, values)
    this.db.persist()
  }

  getLatestByProject(project: string): Session | undefined {
    const result = this.db.getDb().exec(
      'SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT 1', [project]
    )
    if (!result[0]?.values[0]) return undefined
    return this.mapRow(result[0].columns, result[0].values[0])
  }

  private mapRow(columns: string[], values: unknown[]): Session {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col] = values[i] })
    return obj as unknown as Session
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- __tests__/db/sessions.test.ts
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/sessions.ts __tests__/db/sessions.test.ts
git commit -m "feat: sessions repository with CRUD"
```

### Task 4: Observations CRUD + Dedup

**Files:**
- Create: `src/utils/hash.ts`
- Create: `src/db/observations.ts`
- Create: `__tests__/utils/hash.test.ts`
- Create: `__tests__/db/observations.test.ts`

- [ ] **Step 1: Write hash utility test + implementation**

`__tests__/utils/hash.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { contentHash } from '../../src/utils/hash.js'

describe('contentHash', () => {
  it('should return consistent SHA256 hex', () => {
    const h1 = contentHash('title', 'narrative')
    const h2 = contentHash('title', 'narrative')
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64) // SHA256 hex length
  })

  it('should differ for different inputs', () => {
    expect(contentHash('a', 'b')).not.toBe(contentHash('c', 'd'))
  })
})
```

`src/utils/hash.ts`:
```typescript
import { createHash } from 'node:crypto'

export function contentHash(title: string, narrative: string): string {
  return createHash('sha256').update(title + narrative).digest('hex')
}
```

- [ ] **Step 2: Write observations tests**

`__tests__/db/observations.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import { ObservationsRepo } from '../../src/db/observations.js'
import { SessionsRepo } from '../../src/db/sessions.js'
import { v7 as uuidv7 } from 'uuid'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('ObservationsRepo', () => {
  let db: Database
  let repo: ObservationsRepo
  let sessionId: string
  const dbPath = path.join(os.tmpdir(), `cc-mem-test-${Date.now()}.db`)

  beforeEach(async () => {
    db = new Database(dbPath)
    await db.init()
    repo = new ObservationsRepo(db)
    const sessions = new SessionsRepo(db)
    sessionId = uuidv7()
    sessions.create({ id: sessionId, project: 'test', started_at: new Date().toISOString() })
  })

  afterEach(async () => {
    await db.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('should create and retrieve an observation', () => {
    const id = uuidv7()
    repo.create({
      id, session_id: sessionId, type: 'feature',
      title: 'Added auth module', narrative: 'Implemented JWT auth',
      project: 'test', created_at: new Date().toISOString()
    })
    const obs = repo.getById(id)
    expect(obs).toBeDefined()
    expect(obs!.title).toBe('Added auth module')
    expect(obs!.type).toBe('feature')
  })

  it('should reject duplicate content_hash within 30s in same session', () => {
    const id1 = uuidv7()
    const id2 = uuidv7()
    const now = new Date().toISOString()
    const input = {
      session_id: sessionId, type: 'discovery' as const,
      title: 'Same title', narrative: 'Same narrative',
      project: 'test', created_at: now
    }
    repo.create({ id: id1, ...input })
    const result = repo.create({ id: id2, ...input })
    expect(result).toBe('duplicate')
    expect(repo.getById(id2)).toBeUndefined()
  })

  it('should list observations by project', () => {
    for (let i = 0; i < 3; i++) {
      repo.create({
        id: uuidv7(), session_id: sessionId, type: 'change',
        title: `Change ${i}`, narrative: `Desc ${i}`,
        project: 'test', created_at: new Date().toISOString()
      })
    }
    const list = repo.listByProject('test', 10)
    expect(list).toHaveLength(3)
  })

  it('should update status', () => {
    const id = uuidv7()
    repo.create({
      id, session_id: sessionId, type: 'decision',
      title: 'Use React', narrative: 'Decided to use React for frontend',
      project: 'test', created_at: new Date().toISOString(), status: 'pending'
    })
    repo.updateStatus(id, 'confirmed')
    expect(repo.getById(id)!.status).toBe('confirmed')
  })

  it('should delete observation', () => {
    const id = uuidv7()
    repo.create({
      id, session_id: sessionId, type: 'bugfix',
      title: 'Fix login', narrative: 'Fixed login bug',
      project: 'test', created_at: new Date().toISOString()
    })
    repo.delete(id)
    expect(repo.getById(id)).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- __tests__/utils/hash.test.ts __tests__/db/observations.test.ts
```

- [ ] **Step 4: Implement ObservationsRepo**

`src/db/observations.ts`:
```typescript
import { Database } from './database.js'

export interface Observation {
  id: string
  session_id: string
  type: string
  title: string
  narrative: string | null
  facts: string | null
  concepts: string | null
  files_read: string | null
  files_modified: string | null
  project: string
  content_hash: string | null
  prompt_number: number | null
  status: string
  reviewed_at: string | null
  created_at: string
  discovery_tokens: number
}

interface CreateObservationInput {
  id: string
  session_id: string
  type: string
  title: string
  narrative?: string
  facts?: string
  concepts?: string
  files_read?: string
  files_modified?: string
  project: string
  prompt_number?: number
  status?: string
  created_at: string
  discovery_tokens?: number
}

export class ObservationsRepo {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateObservationInput): 'created' | 'duplicate' {
    const { contentHash } = require('../utils/hash.js') as typeof import('../utils/hash.js')
    // Use import dynamically for ESM
    const hash = input.narrative ? contentHash(input.title, input.narrative) : null

    // Check for duplicate
    if (hash) {
      const dup = this.db.getDb().exec(
        `SELECT id FROM observations WHERE content_hash = ? AND session_id = ? AND created_at > datetime(?)`,
        [hash, input.session_id, new Date(Date.now() - 30000).toISOString()]
      )
      if (dup[0]?.values.length) return 'duplicate'
    }

    this.db.getDb().run(
      `INSERT INTO observations (id, session_id, type, title, narrative, facts, concepts, files_read, files_modified, project, content_hash, prompt_number, status, created_at, discovery_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.id, input.session_id, input.type, input.title, input.narrative ?? null,
       input.facts ?? null, input.concepts ?? null, input.files_read ?? null, input.files_modified ?? null,
       input.project, hash, input.prompt_number ?? null, input.status ?? 'confirmed',
       input.created_at, input.discovery_tokens ?? 0]
    )
    this.db.persist()
    return 'created'
  }

  getById(id: string): Observation | undefined {
    const result = this.db.getDb().exec('SELECT * FROM observations WHERE id = ?', [id])
    if (!result[0]?.values[0]) return undefined
    return this.mapRow(result[0].columns, result[0].values[0])
  }

  listByProject(project: string, limit: number): Observation[] {
    const result = this.db.getDb().exec(
      'SELECT * FROM observations WHERE project = ? ORDER BY created_at DESC LIMIT ?',
      [project, limit]
    )
    if (!result[0]) return []
    return result[0].values.map(row => this.mapRow(result[0].columns, row))
  }

  listBySession(sessionId: string): Observation[] {
    const result = this.db.getDb().exec(
      'SELECT * FROM observations WHERE session_id = ? ORDER BY created_at',
      [sessionId]
    )
    if (!result[0]) return []
    return result[0].values.map(row => this.mapRow(result[0].columns, row))
  }

  updateStatus(id: string, status: string): void {
    this.db.getDb().run(
      'UPDATE observations SET status = ?, reviewed_at = ? WHERE id = ?',
      [status, new Date().toISOString(), id]
    )
    this.db.persist()
  }

  delete(id: string): void {
    this.db.getDb().run('DELETE FROM observations WHERE id = ?', [id])
    this.db.persist()
  }

  listProjects(): { project: string; count: number; last_activity: string }[] {
    const result = this.db.getDb().exec(
      'SELECT project, COUNT(*) as count, MAX(created_at) as last_activity FROM observations GROUP BY project ORDER BY last_activity DESC'
    )
    if (!result[0]) return []
    return result[0].values.map(row => ({
      project: row[0] as string,
      count: row[1] as number,
      last_activity: row[2] as string,
    }))
  }

  private mapRow(columns: string[], values: unknown[]): Observation {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col] = values[i] })
    return obj as unknown as Observation
  }
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/hash.ts src/db/observations.ts __tests__/utils/ __tests__/db/observations.test.ts
git commit -m "feat: observations CRUD with dedup, hash utility"
```

### Task 5: FTS5 Search

**Files:**
- Create: `src/db/search.ts`
- Create: `__tests__/db/search.test.ts`

- [ ] **Step 1: Write failing test**

`__tests__/db/search.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from '../../src/db/database.js'
import { SearchRepo } from '../../src/db/search.js'
import { ObservationsRepo } from '../../src/db/observations.js'
import { SessionsRepo } from '../../src/db/sessions.js'
import { v7 as uuidv7 } from 'uuid'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('SearchRepo', () => {
  let db: Database
  let search: SearchRepo
  let obs: ObservationsRepo
  let sessionId: string
  const dbPath = path.join(os.tmpdir(), `cc-mem-test-${Date.now()}.db`)

  beforeEach(async () => {
    db = new Database(dbPath)
    await db.init()
    search = new SearchRepo(db)
    obs = new ObservationsRepo(db)
    const sessions = new SessionsRepo(db)
    sessionId = uuidv7()
    sessions.create({ id: sessionId, project: 'test', started_at: new Date().toISOString() })
  })

  afterEach(async () => {
    await db.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('should find observations by keyword', () => {
    obs.create({ id: uuidv7(), session_id: sessionId, type: 'feature', title: 'Added authentication', narrative: 'JWT token auth', project: 'test', created_at: new Date().toISOString() })
    obs.create({ id: uuidv7(), session_id: sessionId, type: 'bugfix', title: 'Fixed CSS layout', narrative: 'Fixed flexbox issue', project: 'test', created_at: new Date().toISOString() })
    const results = search.search('authentication')
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Added authentication')
  })

  it('should filter by project', () => {
    obs.create({ id: uuidv7(), session_id: sessionId, type: 'feature', title: 'Auth feature', narrative: 'desc', project: 'test', created_at: new Date().toISOString() })
    const results = search.search('Auth', { project: 'other-project' })
    expect(results).toHaveLength(0)
  })

  it('should return empty for no matches', () => {
    const results = search.search('nonexistent')
    expect(results).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement SearchRepo**

`src/db/search.ts`:
```typescript
import { Database } from './database.js'
import { Observation } from './observations.js'

interface SearchOptions {
  limit?: number
  type?: string
  project?: string
  status?: string
  since?: string
}

interface SearchResult extends Observation {
  rank: number
}

export class SearchRepo {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const { limit = 10, type, project, status, since } = options
    let sql = `
      SELECT o.*, fts.rank
      FROM observations_fts fts
      JOIN observations o ON o.rowid = fts.rowid
      WHERE observations_fts MATCH ?
    `
    const params: unknown[] = [query]

    if (project) { sql += ' AND o.project = ?'; params.push(project) }
    if (type) { sql += ' AND o.type = ?'; params.push(type) }
    if (status) { sql += ' AND o.status = ?'; params.push(status) }
    if (since) { sql += ' AND o.created_at > ?'; params.push(since) }

    sql += ' ORDER BY fts.rank LIMIT ?'
    params.push(limit)

    const result = this.db.getDb().exec(sql, params)
    if (!result[0]) return []

    return result[0].values.map(row => {
      const obj: Record<string, unknown> = {}
      result[0].columns.forEach((col, i) => { obj[col] = row[i] })
      return obj as unknown as SearchResult
    })
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/search.ts __tests__/db/search.test.ts
git commit -m "feat: FTS5 full-text search"
```

---

## Chunk 2: LLM Provider + Project Detection

### Task 6: Project Name Detection

**Files:**
- Create: `src/utils/project.ts`
- Create: `__tests__/utils/project.test.ts`

- [ ] **Step 1: Write failing test**

`__tests__/utils/project.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { detectProject } from '../../src/utils/project.js'

describe('detectProject', () => {
  it('should return basename if no git repo', () => {
    expect(detectProject('/tmp/some-folder')).toBe('some-folder')
  })

  it('should use explicitly provided project name', () => {
    expect(detectProject('/any/path', 'my-project')).toBe('my-project')
  })
})
```

- [ ] **Step 2: Implement**

`src/utils/project.ts`:
```typescript
import { execSync } from 'node:child_process'
import path from 'node:path'

export function detectProject(cwd: string, explicit?: string): string {
  if (explicit) return explicit

  // Try git repo root folder name
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf-8' }).trim()
    return path.basename(gitRoot)
  } catch {
    // Not a git repo
  }

  return path.basename(cwd)
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm test -- __tests__/utils/project.test.ts
git add src/utils/project.ts __tests__/utils/project.test.ts
git commit -m "feat: project name detection from git repo or cwd"
```

### Task 7: LLMProvider Interface + ZhipuProvider

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/llm/providers/zhipu.ts`
- Create: `__tests__/llm/zhipu.test.ts`

- [ ] **Step 1: Define interface**

`src/llm/provider.ts`:
```typescript
export interface ExtractedObservation {
  type: string
  title: string
  narrative: string
  facts: string[]
  concepts: string[]
  files_read: string[]
  files_modified: string[]
}

export interface SessionSummary {
  request: string
  investigated: string[]
  learned: string[]
  completed: string[]
  next_steps: string[]
}

export interface LLMProvider {
  extractObservation(rawContext: string): Promise<ExtractedObservation | { skip: true }>
  summarizeSession(observationsText: string): Promise<SessionSummary>
}
```

- [ ] **Step 2: Write failing test for ZhipuProvider**

`__tests__/llm/zhipu.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { ZhipuProvider } from '../../src/llm/providers/zhipu.js'

describe('ZhipuProvider', () => {
  it('should skip non-valuable content', async () => {
    // Without a real API key, test the prompt construction + JSON parsing
    const provider = new ZhipuProvider({ apiKey: 'test', model: 'glm-4-flash' })
    // We test the JSON parsing logic separately
    const result = provider.parseResponse('{"skip": true}')
    expect(result).toEqual({ skip: true })
  })

  it('should parse valid observation JSON', () => {
    const provider = new ZhipuProvider({ apiKey: 'test', model: 'glm-4-flash' })
    const result = provider.parseResponse(JSON.stringify({
      type: 'feature',
      title: 'Added auth',
      narrative: 'Implemented JWT',
      facts: ['uses bcrypt'],
      concepts: ['security'],
      files_read: ['auth.ts'],
      files_modified: ['auth.ts']
    }))
    expect(result.type).toBe('feature')
    expect(result.title).toBe('Added auth')
  })

  it('should handle markdown-wrapped JSON', () => {
    const provider = new ZhipuProvider({ apiKey: 'test', model: 'glm-4-flash' })
    const result = provider.parseResponse('```json\n{"skip": true}\n```')
    expect(result).toEqual({ skip: true })
  })

  it('should return null for unparseable response', () => {
    const provider = new ZhipuProvider({ apiKey: 'test', model: 'glm-4-flash' })
    const result = provider.parseResponse('This is not JSON at all')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: Implement ZhipuProvider**

`src/llm/providers/zhipu.ts`:
```typescript
import { LLMProvider, ExtractedObservation, SessionSummary } from '../provider.js'

interface ZhipuConfig {
  apiKey: string
  model: string
  baseUrl?: string
  timeout?: number
}

const EXTRACTION_SYSTEM_PROMPT = `你是一个工作记忆提取器。从下面的对话内容中提取一条结构化观察记录。

规则：
1. 只记录有持久价值的信息（学到了什么、决定了什么、发现了什么）
2. 跳过：状态查询、确认消息、格式化输出、无实质内容的操作
3. title 用祈使句，5-15 字中文
4. narrative 用 2-5 句，说明发生了什么和为什么重要
5. facts 提取关键数字、文件名、配置项等可检索事实
6. type 只能是: bugfix, feature, refactor, change, discovery, decision
7. concepts 从这些中选择: how-it-works, why-it-exists, what-changed, workaround, performance, security, api-design, architecture, config

严格输出 JSON，不要其他文字：
{"type":"...","title":"...","narrative":"...","facts":["..."],"concepts":["..."],"files_read":["..."],"files_modified":["..."]}

如果没有值得记录的内容，输出：{"skip": true}`

const SUMMARY_SYSTEM_PROMPT = `你是一个会话总结器。根据下面的观察记录，生成一份工作会话摘要。

规则：
1. request: 用一句话说用户这次想做什么
2. investigated: 探索了哪些方向
3. learned: 关键发现和洞察
4. completed: 实际完成了什么
5. next_steps: 如果有未完成的工作，下一步应该做什么
6. 语言和原始内容保持一致（中文用中文）

输出 JSON：
{"request":"...","investigated":["..."],"learned":["..."],"completed":["..."],"next_steps":["..."]}`

export class ZhipuProvider implements LLMProvider {
  private config: Required<ZhipuConfig>
  private consecutiveFailures = 0
  private cooldownUntil = 0

  constructor(config: ZhipuConfig) {
    this.config = {
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      timeout: 10000,
      ...config,
    }
  }

  async extractObservation(rawContext: string): Promise<ExtractedObservation | { skip: true }> {
    const response = await this.call('提取观察记录', rawContext, EXTRACTION_SYSTEM_PROMPT)
    const parsed = this.parseResponse(response) as ExtractedObservation | { skip: true } | null
    if (!parsed) return { skip: true }
    return parsed
  }

  async summarizeSession(observationsText: string): Promise<SessionSummary> {
    const response = await this.call('生成会话摘要', observationsText, SUMMARY_SYSTEM_PROMPT)
    const parsed = this.parseResponse(response) as SessionSummary | null
    if (!parsed) return { request: '', investigated: [], learned: [], completed: [], next_steps: [] }
    return parsed
  }

  parseResponse(text: string): ExtractedObservation | SessionSummary | { skip: true } | null {
    let clean = text.trim()
    // Strip markdown code blocks
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    try {
      return JSON.parse(clean)
    } catch {
      return null
    }
  }

  private async call(label: string, userContent: string, systemPrompt: string): Promise<string> {
    if (Date.now() < this.cooldownUntil) {
      throw new Error('LLM in cooldown')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const res = await fetch(this.config.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.1,
        }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)

      const data = await res.json() as { choices: { message: { content: string } }[]; usage?: { total_tokens: number } }
      this.consecutiveFailures = 0
      return data.choices[0]?.message?.content ?? ''
    } catch (e) {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= 3) {
        this.cooldownUntil = Date.now() + 5 * 60 * 1000
        this.consecutiveFailures = 0
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npm test -- __tests__/llm/
git add src/llm/ __tests__/llm/
git commit -m "feat: LLMProvider interface + ZhipuProvider with JSON parsing"
```

---

## Chunk 3: MCP Server + Tools

### Task 8: Context Formatting Utility

**Files:**
- Create: `src/utils/format.ts`
- Create: `__tests__/utils/format.test.ts`

- [ ] **Step 1: Write failing test**

`__tests__/utils/format.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { formatContext } from '../../src/utils/format.js'
import { Observation } from '../../src/db/observations.js'

describe('formatContext', () => {
  const observations: Partial<Observation>[] = [
    { id: '1', type: 'feature', title: 'Added auth', created_at: '2026-04-17T10:15:00Z' },
    { id: '2', type: 'decision', title: 'Use React', created_at: '2026-04-17T10:20:00Z' },
  ]

  it('should format observations as compact context', () => {
    const output = formatContext(observations as Observation[], 'test-project', 2)
    expect(output).toContain('[cc-mem]')
    expect(output).toContain('feature')
    expect(output).toContain('Added auth')
    expect(output).toContain('decision')
  })
})
```

- [ ] **Step 2: Implement**

`src/utils/format.ts`:
```typescript
import { Observation } from '../db/observations.js'

const TYPE_ICONS: Record<string, string> = {
  session: '🎯', bugfix: '🔴', feature: '🟣', refactor: '🔄',
  change: '✅', discovery: '🔵', decision: '⚖️',
}

export function formatContext(observations: Observation[], project: string, totalTokens: number): string {
  if (observations.length === 0) return `[cc-mem] No recent context for ${project}`

  const now = new Date()
  const header = `[cc-mem] recent context, ${now.toLocaleString('zh-CN', { timeZoneName: 'short' })}`

  const legend = `Legend: ${Object.entries(TYPE_ICONS).map(([k, v]) => `${v}${k}`).join(' ')}`
  const formatLine = `Format: ID TIME TYPE TITLE`

  const lines = observations.map(o => {
    const icon = TYPE_ICONS[o.type] || '·'
    const time = new Date(o.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: true })
    return `${o.id.slice(0, 4)} ${time} ${icon} ${o.title}`
  })

  const stats = `Stats: ${observations.length} obs | ${totalTokens}t work`

  return [header, '', legend, formatLine, '', ...lines, '', stats].join('\n')
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm test -- __tests__/utils/format.test.ts
git add src/utils/format.ts __tests__/utils/format.test.ts
git commit -m "feat: context formatting utility"
```

### Task 9: MCP Server + All Tools + Resources

**Files:**
- Create: `src/server.ts`
- Create: `src/tools/add-observation.ts`
- Create: `src/tools/search.ts`
- Create: `src/tools/get-context.ts`
- Create: `src/tools/summarize.ts`
- Create: `src/tools/review-observation.ts`
- Create: `src/tools/list-projects.ts`
- Create: `src/tools/delete-observation.ts`
- Create: `src/resources/context.ts`
- Create: `src/resources/session.ts`
- Create: `src/prompts/usage-guide.ts`

This is the largest task. Each tool is thin — it validates input, calls a repo method, returns MCP-formatted result.

- [ ] **Step 1: Create server.ts with MCP server setup, tool registration, and resource handlers**

`src/server.ts` — wire up `@modelcontextprotocol/sdk` McpServer, register all tools and resources, accept Database + LLMProvider instances.

- [ ] **Step 2: Implement each tool file** (each ~20-40 lines, calling repo methods)

- `add-observation.ts`: validate type enum, call ObservationsRepo.create, if raw_context provided call llm.extractObservation first
- `search.ts`: call SearchRepo.search, format results
- `get-context.ts`: call ObservationsRepo.listByProject + SessionsRepo.getLatestByProject for summary
- `summarize.ts`: call ObservationsRepo.listBySession, pass to llm.summarizeSession, save to SessionsRepo
- `review-observation.ts`: call ObservationsRepo.updateStatus or delete for "reject"
- `list-projects.ts`: call ObservationsRepo.listProjects
- `delete-observation.ts`: call ObservationsRepo.delete

- [ ] **Step 3: Implement resources**

- `context.ts`: formatContext output as resource content
- `session.ts`: JSON dump of session + its observations

- [ ] **Step 4: Implement usage-guide prompt**

- [ ] **Step 5: Run build**

```bash
npm run build
```
Expected: compiles without errors

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/tools/ src/resources/ src/prompts/
git commit -m "feat: MCP server with all tools, resources, and prompts"
```

### Task 10: CLI Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement entry point**

`src/index.ts`:
```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Database } from './db/database.js'
import { createServer } from './server.js'
import { ZhipuProvider } from './llm/providers/zhipu.js'
import path from 'node:path'
import os from 'node:os'

async function main() {
  const dbPath = process.env.CC_MEM_DB_PATH
    || path.join(os.homedir(), '.cc-mem', 'memories.db')

  const db = new Database(dbPath)
  await db.init()

  const apiKey = process.env.CC_MEM_ZHIPU_API_KEY || ''
  const model = process.env.CC_MEM_ZHIPU_MODEL || 'glm-4-flash'
  const llm = new ZhipuProvider({ apiKey, model })

  const server = createServer({ db, llm })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error('cc-mem fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Build and test**

```bash
npm run build
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | node dist/index.js
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI entry point with stdio MCP transport"
```

---

## Chunk 4: Integration Testing + README

### Task 11: Integration Test

**Files:**
- Create: `__tests__/tools/integration.test.ts`

- [ ] **Step 1: Write integration test that exercises full tool flow**

Test: create session → add observation → search → get_context → summarize → list_projects → delete

- [ ] **Step 2: Run full test suite**

```bash
npm test
```
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add __tests__/tools/integration.test.ts
git commit -m "test: integration test for full tool flow"
```

### Task 12: README + Final Polish

**Files:**
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Write README with install, config, usage examples**

- [ ] **Step 2: Create .gitignore**

```
node_modules/
dist/
*.db
*.db.bak
```

- [ ] **Step 3: Final build + test**

```bash
npm run build && npm test
```

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: README with install and usage guide"
```
