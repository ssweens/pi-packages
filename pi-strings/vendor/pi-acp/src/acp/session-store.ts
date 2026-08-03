import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { lockSync } from 'proper-lockfile'
import writeFileAtomic from 'write-file-atomic'
import { getPiAcpSessionMapPath } from './paths.js'

export type StoredSession = {
  sessionId: string
  cwd: string
  sessionFile: string
  updatedAt: string
}

type SessionMapFile = {
  version: 1
  sessions: Record<string, StoredSession>
}

const EMPTY: SessionMapFile = { version: 1, sessions: {} }

function ensureParentDir(path: string): string {
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  chmodSync(parent, 0o700)
  return parent
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return ['sessionId', 'cwd', 'sessionFile', 'updatedAt'].every(key => typeof record[key] === 'string' && record[key] !== '')
}

function loadFile(path: string): SessionMapFile {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY, sessions: {} }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Corrupt pi-acp session map at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid pi-acp session map at ${path}`)
  const record = parsed as { version?: unknown; sessions?: unknown }
  if (record.version !== 1 || !record.sessions || typeof record.sessions !== 'object' || Array.isArray(record.sessions)) {
    throw new Error(`Unsupported pi-acp session map schema at ${path}`)
  }
  for (const [id, value] of Object.entries(record.sessions)) {
    if (!isStoredSession(value) || value.sessionId !== id) throw new Error(`Invalid pi-acp session entry ${id} at ${path}`)
  }
  return parsed as SessionMapFile
}

function saveFile(path: string, data: SessionMapFile): void {
  writeFileAtomic.sync(path, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

export class SessionStore {
  private readonly path: string
  private readonly lockTarget: string

  constructor(path = getPiAcpSessionMapPath()) {
    this.path = path
    this.lockTarget = ensureParentDir(path)
  }

  private locked<T>(operation: () => T): T {
    const release = lockSync(this.lockTarget, { realpath: false, stale: 30_000 })
    try { return operation() } finally { release() }
  }

  get(sessionId: string): StoredSession | null {
    return this.locked(() => loadFile(this.path).sessions[sessionId] ?? null)
  }

  upsert(entry: { sessionId: string; cwd: string; sessionFile: string }): void {
    this.locked(() => {
      const db = loadFile(this.path)
      db.sessions[entry.sessionId] = { ...entry, updatedAt: new Date().toISOString() }
      saveFile(this.path, db)
    })
  }

  delete(sessionId: string): void {
    this.locked(() => {
      const db = loadFile(this.path)
      if (!db.sessions[sessionId]) return
      delete db.sessions[sessionId]
      saveFile(this.path, db)
    })
  }
}
