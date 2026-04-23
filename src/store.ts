import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import type { UnifiedTokenEvent } from './types.js';

const CURRENT_VERSION = 1;

export interface StoreState {
  events: UnifiedTokenEvent[];
  hashes: Set<string>;
  path: string;
}

export function getStoreDir(): string {
  const override = (process.env.TOKENBBQ_DATA_DIR ?? '').trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), '.tokenbbq');
}

function storeFilePath(): string {
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
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

export function loadStore(): StoreState {
  const dir = getStoreDir();
  const file = storeFilePath();

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) {
    appendFileSync(file, '');
    return { events: [], hashes: new Set(), path: file };
  }

  const raw = readFileSync(file, 'utf-8');
  const events: UnifiedTokenEvent[] = [];
  const hashes = new Set<string>();

  let badSeen = 0;
  let futureSeen = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      badSeen++;
      continue;
    }

    const rawV = parsed.v;
    let v: number;
    if (rawV === undefined) {
      v = 1;  // absent = legacy v1 for back-compat
    } else if (typeof rawV === 'number' && Number.isFinite(rawV)) {
      v = rawV;
    } else {
      badSeen++;  // present but not a finite number = malformed
      continue;
    }
    if (v > CURRENT_VERSION) {
      futureSeen++;
      continue;
    }

    const hash = typeof parsed.eventHash === 'string' ? parsed.eventHash : null;
    if (!hash || hashes.has(hash)) continue;

    if (
      typeof parsed.source !== 'string' ||
      typeof parsed.timestamp !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.model !== 'string' ||
      !parsed.tokens || typeof parsed.tokens !== 'object'
    ) {
      badSeen++;
      continue;
    }

    hashes.add(hash);
    events.push({
      source: parsed.source as UnifiedTokenEvent['source'],
      timestamp: parsed.timestamp as string,
      sessionId: parsed.sessionId as string,
      model: parsed.model as string,
      tokens: parsed.tokens as UnifiedTokenEvent['tokens'],
      costUSD: typeof parsed.costUSD === 'number' ? parsed.costUSD : 0,
      project: typeof parsed.project === 'string' ? parsed.project : undefined,
    });
  }

  if (badSeen > 0) console.warn(`tokenbbq: skipped ${badSeen} malformed line(s) in store`);
  if (futureSeen > 0) console.warn(`tokenbbq: skipped ${futureSeen} line(s) with future schema version`);

  return { events, hashes, path: file };
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

  // Concurrent-write note: appendFileSync is atomic per write under PIPE_BUF (~4KB) on POSIX.
  // On Windows NTFS there is no such guarantee. Two tokenbbq processes writing simultaneously
  // could interleave a large batch and produce a malformed line (self-skipped on next load as
  // "bad line"); the events in that malformed line would be lost. v1 accepts this tradeoff;
  // a follow-up could add lockfile protection for batches > a few KB.
  if (buffer) appendFileSync(state.path, buffer);
  return added;
}
