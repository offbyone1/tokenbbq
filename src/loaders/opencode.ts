import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { UnifiedTokenEvent } from '../types.js';
import { resolveProjectRoot } from '../project.js';

const HOME = homedir();

function getOpenCodeDir(): string | null {
  const envPath = (process.env.OPENCODE_DATA_DIR ?? '').trim();
  if (envPath !== '') {
    const resolved = path.resolve(envPath);
    if (existsSync(path.join(resolved, 'opencode.db'))) return resolved;
  }
  const defaultPath = path.join(HOME, '.local', 'share', 'opencode');
  if (existsSync(path.join(defaultPath, 'opencode.db'))) return defaultPath;
  return null;
}

interface ProjectRow { id: string; worktree: string }
interface SessionRow { id: string; project_id: string; directory: string }

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export async function loadOpenCodeEvents(): Promise<UnifiedTokenEvent[]> {
  const dir = getOpenCodeDir();
  if (!dir) return [];
  const dbFile = path.join(dir, 'opencode.db');

  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  try {
    SQL = await initSqlJs();
  } catch (err) {
    console.warn('tokenbbq: failed to initialize sql.js for OpenCode loader:', err);
    return [];
  }

  let db: InstanceType<typeof SQL.Database>;
  try {
    const buffer = readFileSync(dbFile);
    db = new SQL.Database(new Uint8Array(buffer));
  } catch (err) {
    console.warn('tokenbbq: failed to open OpenCode DB:', err);
    return [];
  }

  const events: UnifiedTokenEvent[] = [];

  try {
    // project_id -> worktree lookup
    const projects = new Map<string, string>();
    const projStmt = db.prepare('SELECT id, worktree FROM project');
    try {
      while (projStmt.step()) {
        const row = projStmt.getAsObject() as unknown as ProjectRow;
        projects.set(row.id, row.worktree ?? '');
      }
    } finally {
      projStmt.free();
    }

    // session_id -> cwd (fallback to project.worktree if session.directory is empty)
    const sessions = new Map<string, string>();
    const sessStmt = db.prepare('SELECT id, project_id, directory FROM session');
    try {
      while (sessStmt.step()) {
        const row = sessStmt.getAsObject() as unknown as SessionRow;
        const cwd = row.directory && row.directory.trim()
          ? row.directory
          : projects.get(row.project_id) ?? '';
        sessions.set(row.id, cwd);
      }
    } finally {
      sessStmt.free();
    }

    // Iterate assistant messages with usage info
    const msgStmt = db.prepare('SELECT id, session_id, time_created, data FROM message');
    try {
      while (msgStmt.step()) {
        const row = msgStmt.getAsObject() as unknown as { id: string; session_id: string; time_created: number; data: string };
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(row.data);
        } catch {
          continue;
        }

        if (payload.role !== 'assistant') continue;

        const tokens = payload.tokens as Record<string, unknown> | undefined;
        if (!tokens) continue;

        const input = numberOr(tokens.input, 0);
        const output = numberOr(tokens.output, 0);
        const reasoning = numberOr(tokens.reasoning, 0);
        const cache = (tokens.cache ?? {}) as Record<string, unknown>;
        const cacheRead = numberOr(cache.read, 0);
        const cacheCreation = numberOr(cache.write, 0);

        if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0 && reasoning === 0) continue;

        const time = payload.time as Record<string, unknown> | undefined;
        const timestampMs = numberOr(time?.created, row.time_created);
        const timestamp = new Date(timestampMs).toISOString();

        const modelID = typeof payload.modelID === 'string' ? payload.modelID : 'unknown';

        const cwd = sessions.get(row.session_id) ?? '';
        const project = cwd ? resolveProjectRoot(cwd).name : undefined;

        events.push({
          source: 'opencode',
          timestamp,
          sessionId: row.session_id,
          model: modelID,
          tokens: { input, output, cacheCreation, cacheRead, reasoning },
          costUSD: 0,
          project,
        });
      }
    } finally {
      msgStmt.free();
    }
  } finally {
    db.close();
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return events;
}
