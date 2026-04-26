import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
  if (buffer) appendFileSync(state.path, buffer);
  return added;
}
