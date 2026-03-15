/**
 * DuckDB Web Worker
 *
 * Runs DuckDB-WASM in a dedicated Web Worker with OPFS persistence.
 * Never blocks the UI thread. All communication via structured RPC messages.
 *
 * Persistence: Uses DuckDB's built-in `opfs://` protocol which handles
 * OPFS file creation, sync access handles, and read/write automatically.
 *
 * OPFS path: /{profileName}.kg.duckdb (+ .wal file)
 */

import * as duckdb from '@duckdb/duckdb-wasm'
import type { WorkerRequest, WorkerResponse } from '../types'
import { CREATE_TABLES } from './schema.sql'

import duckdbWasmEH from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdbWorkerEH from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import duckdbWasmMVP from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import duckdbWorkerMVP from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'

let db: duckdb.AsyncDuckDB | null = null
let conn: duckdb.AsyncDuckDBConnection | null = null

// ============================================================================
// Initialization
// Debounced CHECKPOINT — flushes WAL to OPFS so data survives page unload.
let checkpointTimer: ReturnType<typeof setTimeout> | null = null
function scheduleCheckpoint() {
  if (checkpointTimer) clearTimeout(checkpointTimer)
  checkpointTimer = setTimeout(async () => {
    if (conn) {
      try { await conn.query('CHECKPOINT') } catch { /* ignore */ }
    }
  }, 1000)
}

// ============================================================================

async function initDuckDB(profileName: string): Promise<void> {
  console.log('[DuckDB Worker] Starting init for profile:', profileName)

  const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: { mainModule: duckdbWasmMVP, mainWorker: duckdbWorkerMVP },
    eh: { mainModule: duckdbWasmEH, mainWorker: duckdbWorkerEH },
  }

  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)

  const innerWorker = new Worker(bundle.mainWorker!)
  const instance = new duckdb.AsyncDuckDB(logger, innerWorker)
  await instance.instantiate(bundle.mainModule, bundle.pthreadWorker)
  console.log('[DuckDB Worker] WASM instantiated')

  // Native OPFS — DuckDB handles file creation, sync access handles, and persistence
  const dbPath = `opfs://${profileName}.kg.duckdb`
  // The opfs:// protocol uses createSyncAccessHandle which is exclusive.
  // On page reload, the old worker may still hold the handle briefly.
  // Retry with backoff — NEVER delete the files (that destroys data).
  const MAX_RETRIES = 10
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await instance.open({
        path: dbPath,
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      })
      break
    } catch (err) {
      const isLock = String(err).includes('createSyncAccessHandle')
      if (isLock && attempt < MAX_RETRIES - 1) {
        const delayMs = (attempt + 1) * 500
        console.warn(`[DuckDB Worker] OPFS lock busy, retry ${attempt + 1}/${MAX_RETRIES} in ${delayMs}ms...`)
        await new Promise(r => setTimeout(r, delayMs))
      } else {
        throw err
      }
    }
  }
  console.log('[DuckDB Worker] Database opened with OPFS persistence')

  db = instance
  conn = await db.connect()

  // Cap memory — DuckDB defaults to 80% of system RAM (2GB+ in browser).
  await conn.query("SET memory_limit = '128MB'")
  await conn.query("SET threads = 1")

  await conn.query(CREATE_TABLES)
  console.log('[DuckDB Worker] Ready (memory_limit=128MB, threads=1)')
}

// ============================================================================
// Query Helpers
// ============================================================================

async function execSQL(sql: string, params?: unknown[]): Promise<void> {
  if (!conn) throw new Error('DuckDB not initialized')

  if (params && params.length > 0) {
    const stmt = await conn.prepare(sql)
    await stmt.send(...(params as []))
    await stmt.close()
  } else {
    await conn.query(sql)
  }
}

function toPlainValue(val: unknown): unknown {
  if (val === null || val === undefined) return val
  if (typeof val === 'bigint') return Number(val)
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val
  if (ArrayBuffer.isView(val)) return Array.from(val as unknown as ArrayLike<number>)
  if (Array.isArray(val)) return val.map(toPlainValue)
  if (typeof val === 'object' && typeof (val as { toArray?: unknown }).toArray === 'function') {
    return ((val as { toArray: () => unknown[] }).toArray()).map(toPlainValue)
  }
  if (typeof val === 'object') {
    const plain: Record<string, unknown> = {}
    for (const key of Object.keys(val as object)) {
      const v = (val as Record<string, unknown>)[key]
      if (typeof v === 'function') continue
      plain[key] = toPlainValue(v)
    }
    return plain
  }
  return val
}

async function querySQL(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  if (!conn) throw new Error('DuckDB not initialized')

  let result
  if (params && params.length > 0) {
    const stmt = await conn.prepare(sql)
    result = await stmt.query(...(params as []))
    await stmt.close()
  } else {
    result = await conn.query(sql)
  }

  return result.toArray().map((row: unknown) => {
    const obj = row as Record<string, unknown>
    const plain: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      plain[key] = toPlainValue(obj[key])
    }
    return plain
  })
}

async function batchExec(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
  if (!conn) throw new Error('DuckDB not initialized')

  await conn.query('BEGIN TRANSACTION')
  try {
    for (const { sql, params } of statements) {
      if (params && params.length > 0) {
        const stmt = await conn.prepare(sql)
        await stmt.send(...(params as []))
        await stmt.close()
      } else {
        await conn.query(sql)
      }
    }
    await conn.query('COMMIT')
  } catch (err) {
    await conn.query('ROLLBACK')
    throw err
  }
}

async function closeDatabase(): Promise<void> {
  if (conn) {
    // Flush WAL to main file before closing
    try { await conn.query('CHECKPOINT') } catch { /* may already be closed */ }
    await conn.close()
    conn = null
  }
  if (db) {
    await db.terminate()
    db = null
  }
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data
  const respond = (response: Omit<WorkerResponse, 'id'>) => {
    self.postMessage({ id, ...response })
  }

  try {
    switch (type) {
      case 'init': {
        const { profileName } = payload as { profileName: string }
        await initDuckDB(profileName)
        respond({ type: 'result', payload: { ready: true } })
        break
      }

      case 'exec': {
        const { sql, params } = payload as { sql: string; params?: unknown[] }
        await execSQL(sql, params)
        scheduleCheckpoint()
        respond({ type: 'result', payload: { ok: true } })
        break
      }

      case 'query': {
        const { sql, params } = payload as { sql: string; params?: unknown[] }
        const rows = await querySQL(sql, params)
        respond({ type: 'result', payload: rows })
        break
      }

      case 'batch': {
        const { statements } = payload as { statements: Array<{ sql: string; params?: unknown[] }> }
        await batchExec(statements)
        scheduleCheckpoint()
        respond({ type: 'result', payload: { ok: true } })
        break
      }

      case 'export': {
        // Not applicable with opfs:// — data is already persisted
        respond({ type: 'result', payload: null })
        break
      }

      case 'close': {
        await closeDatabase()
        respond({ type: 'result', payload: { closed: true } })
        break
      }

      default:
        respond({ type: 'error', payload: `Unknown message type: ${type}` })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    respond({ type: 'error', payload: message })
  }
}
