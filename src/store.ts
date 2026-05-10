import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import type { UnifiedTokenEvent } from './types.js';

const CURRENT_VERSION = 1;

export interface StoreState {
  events: UnifiedTokenEvent[];
  hashes: Set<string>;
  /** Per-process append target. */
  path: string;
}

export function getStoreDir(): string {
  const override = (process.env.TOKENBBQ_DATA_DIR ?? '').trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), '.tokenbbq');
}

function getEventsDir(): string {
  return path.join(getStoreDir(), 'events');
}

function getStoreCachePath(): string {
  return path.join(getStoreDir(), 'cache', 'store-v1.json');
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Per-process append target. Each tokenbbq process appends only to its own
 * file, so no two processes ever write to the same file at the same time.
 * PID is unique per running process; hostname disambiguates if the data dir
 * is on shared storage. PID reuse across reboots is fine — the prior owner
 * is gone and append-only-then-dedup handles the union cleanly.
 */
function getProcessFilePath(): string {
  const filename = `events-${sanitizeForFilename(hostname())}-${process.pid}.ndjson`;
  return path.join(getEventsDir(), filename);
}

/** Legacy single-file store path. Read for migration; never written to. */
function getLegacyFilePath(): string {
  return path.join(getStoreDir(), 'events.ndjson');
}

export function hashEvent(e: UnifiedTokenEvent): string {
  const payload = [
    e.source,
    e.sessionId,
    e.timestamp,
    e.model,
    e.tokens.input,
    e.tokens.output,
    e.tokens.cacheRead,
    e.tokens.cacheCreation ?? 0,
    e.tokens.reasoning ?? 0,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

interface LoadOutcome {
  events: UnifiedTokenEvent[];
  hashes: Set<string>;
  badSeen: number;
  futureSeen: number;
}

interface StoreFileMeta {
  path: string;
  mtimeMs: number;
  size: number;
}

interface StoreReadCache {
  v: number;
  files: StoreFileMeta[];
  events: UnifiedTokenEvent[];
}

function fileMeta(file: string): StoreFileMeta | null {
  try {
    const s = statSync(file);
    if (!s.isFile() || s.size === 0) return null;
    return { path: file, mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

function listStoreFiles(eventsDir: string): StoreFileMeta[] {
  const files: StoreFileMeta[] = [];
  const legacy = fileMeta(getLegacyFilePath());
  if (legacy) files.push(legacy);

  let entries: string[] = [];
  try {
    entries = readdirSync(eventsDir);
  } catch {
    // ignore - fresh install with empty dir
  }

  for (const name of entries) {
    if (!name.endsWith('.ndjson')) continue;
    const meta = fileMeta(path.join(eventsDir, name));
    if (meta) files.push(meta);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function sameFileSet(a: StoreFileMeta[], b: StoreFileMeta[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.path !== b[i]!.path || a[i]!.mtimeMs !== b[i]!.mtimeMs || a[i]!.size !== b[i]!.size) {
      return false;
    }
  }
  return true;
}

function isTokenCounts(v: unknown): v is UnifiedTokenEvent['tokens'] {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.input === 'number' &&
    typeof t.output === 'number' &&
    typeof t.cacheCreation === 'number' &&
    typeof t.cacheRead === 'number' &&
    typeof t.reasoning === 'number'
  );
}

function isStoreEvent(v: unknown): v is UnifiedTokenEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.source === 'string' &&
    typeof e.timestamp === 'string' &&
    typeof e.sessionId === 'string' &&
    typeof e.model === 'string' &&
    isTokenCounts(e.tokens) &&
    typeof e.costUSD === 'number'
  );
}

function outcomeFromEvents(events: UnifiedTokenEvent[]): LoadOutcome {
  const outcome: LoadOutcome = { events: [], hashes: new Set(), badSeen: 0, futureSeen: 0 };
  for (const event of events) {
    const hash = hashEvent(event);
    if (outcome.hashes.has(hash)) continue;
    outcome.hashes.add(hash);
    outcome.events.push(event);
  }
  return outcome;
}

function readStoreCache(files: StoreFileMeta[]): LoadOutcome | null {
  try {
    const parsed = JSON.parse(readFileSync(getStoreCachePath(), 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const cache = parsed as StoreReadCache;
    if (cache.v !== CURRENT_VERSION || !Array.isArray(cache.files) || !Array.isArray(cache.events)) return null;
    if (!sameFileSet(cache.files, files)) return null;
    if (!cache.events.every(isStoreEvent)) return null;
    return outcomeFromEvents(cache.events);
  } catch {
    return null;
  }
}

function writeStoreCache(files: StoreFileMeta[], events: UnifiedTokenEvent[]): void {
  const target = getStoreCachePath();
  const dir = path.dirname(target);
  const tmp = path.join(dir, `${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify({ v: CURRENT_VERSION, files, events }), 'utf-8');
    renameSync(tmp, target);
  } catch {
    // Performance-only cache. Store reads must keep working if this fails.
  }
}

function loadFile(file: string, into: LoadOutcome): void {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      into.badSeen++;
      continue;
    }

    const rawV = parsed.v;
    let v: number;
    if (rawV === undefined) {
      v = 1;
    } else if (typeof rawV === 'number' && Number.isFinite(rawV)) {
      v = rawV;
    } else {
      into.badSeen++;
      continue;
    }
    if (v > CURRENT_VERSION) {
      into.futureSeen++;
      continue;
    }

    if (
      typeof parsed.source !== 'string' ||
      typeof parsed.timestamp !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.model !== 'string' ||
      !parsed.tokens || typeof parsed.tokens !== 'object'
    ) {
      into.badSeen++;
      continue;
    }

    const event: UnifiedTokenEvent = {
      source: parsed.source as UnifiedTokenEvent['source'],
      timestamp: parsed.timestamp as string,
      sessionId: parsed.sessionId as string,
      model: parsed.model as string,
      tokens: parsed.tokens as UnifiedTokenEvent['tokens'],
      costUSD: typeof parsed.costUSD === 'number' ? parsed.costUSD : 0,
      project: typeof parsed.project === 'string' ? parsed.project : undefined,
    };

    // Recompute hash from canonical fields rather than trusting the on-disk
    // eventHash. Keeps dedup correct across hash-function changes and across
    // the union of all per-process files.
    const hash = hashEvent(event);
    if (into.hashes.has(hash)) continue;
    into.hashes.add(hash);
    into.events.push(event);
  }
}

export function loadStore(): StoreState {
  const root = getStoreDir();
  const eventsDir = getEventsDir();
  const ownFile = getProcessFilePath();

  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  if (!existsSync(eventsDir)) mkdirSync(eventsDir, { recursive: true });
  if (!existsSync(ownFile)) appendFileSync(ownFile, '');

  const files = listStoreFiles(eventsDir);
  const cached = readStoreCache(files);
  if (cached) return { events: cached.events, hashes: cached.hashes, path: ownFile };

  const outcome: LoadOutcome = {
    events: [],
    hashes: new Set(),
    badSeen: 0,
    futureSeen: 0,
  };

  // Read the legacy single-file store first (for users upgrading from the
  // pre-multi-process layout). It is never written to again — new events
  // land in the per-process file. Once a user is fully migrated they can
  // delete it manually; we don't auto-delete to keep the migration safe.
  const legacy = getLegacyFilePath();
  if (existsSync(legacy)) loadFile(legacy, outcome);

  // Then read every per-process file in events/. Order doesn't matter because
  // dedup is content-hash-based.
  let entries: string[] = [];
  try {
    entries = readdirSync(eventsDir);
  } catch {
    // ignore — fresh install with empty dir
  }
  for (const name of entries) {
    if (!name.endsWith('.ndjson')) continue;
    loadFile(path.join(eventsDir, name), outcome);
  }

  if (outcome.badSeen > 0) console.warn(`tokenbbq: skipped ${outcome.badSeen} malformed line(s) in store`);
  if (outcome.futureSeen > 0) console.warn(`tokenbbq: skipped ${outcome.futureSeen} line(s) with future schema version`);

  writeStoreCache(files, outcome.events);
  return { events: outcome.events, hashes: outcome.hashes, path: ownFile };
}

export function appendEvents(state: StoreState, events: UnifiedTokenEvent[]): UnifiedTokenEvent[] {
  const added: UnifiedTokenEvent[] = [];
  let buffer = '';

  for (const e of events) {
    const hash = hashEvent(e);
    if (state.hashes.has(hash)) continue;
    state.hashes.add(hash);
    state.events.push(e);
    added.push(e);
    buffer += JSON.stringify({ v: CURRENT_VERSION, ...e, eventHash: hash }) + '\n';
  }

  // Multi-process safety: each process owns its own file (state.path is
  // events/events-<host>-<pid>.ndjson), so there's no cross-process write
  // contention. Two processes that race to scan the same upstream tool can
  // each persist the same event into their own file; loadStore unions and
  // dedupes them on the next read. Slightly redundant on disk, lossless.
  if (buffer) {
    appendFileSync(state.path, buffer);
    writeStoreCache(listStoreFiles(getEventsDir()), state.events);
  }
  return added;
}
