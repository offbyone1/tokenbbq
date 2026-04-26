import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadStore, appendEvents, hashEvent, getStoreDir } from './store.js';
import type { UnifiedTokenEvent } from './types.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'tbq-store-'));
  process.env.TOKENBBQ_DATA_DIR = tmp;
});
afterEach(() => {
  delete process.env.TOKENBBQ_DATA_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

function ev(over: Partial<UnifiedTokenEvent> = {}): UnifiedTokenEvent {
  return {
    source: 'codex',
    timestamp: '2026-04-22T14:02:11.812Z',
    sessionId: 's1',
    model: 'gpt-5',
    tokens: { input: 100, output: 200, cacheCreation: 0, cacheRead: 50, reasoning: 0 },
    costUSD: 0,
    ...over,
  };
}

describe('hashEvent', () => {
  test('is deterministic', () => {
    assert.equal(hashEvent(ev()), hashEvent(ev()));
  });
  test('changes when timestamp changes', () => {
    assert.notEqual(hashEvent(ev()), hashEvent(ev({ timestamp: '2026-04-22T14:02:12.000Z' })));
  });
  test('changes when source changes', () => {
    assert.notEqual(hashEvent(ev()), hashEvent(ev({ source: 'claude-code' })));
  });
});

describe('getStoreDir', () => {
  test('honors TOKENBBQ_DATA_DIR', () => {
    assert.equal(getStoreDir(), tmp);
  });
});

describe('loadStore', () => {
  test('returns empty state when file is missing', () => {
    const state = loadStore();
    assert.equal(state.events.length, 0);
    assert.equal(state.hashes.size, 0);
    assert.equal(state.path, path.join(tmp, 'events.ndjson'));
    assert.ok(existsSync(path.join(tmp, 'events.ndjson')));
  });

  test('reads existing NDJSON file and dedups duplicates on load', () => {
    const e = ev();
    const h = hashEvent(e);
    const line = JSON.stringify({ v: 1, ...e, eventHash: h }) + '\n';
    appendFileSync(path.join(tmp, 'events.ndjson'), line + line + line);

    const state = loadStore();
    assert.equal(state.events.length, 1);
    assert.equal(state.hashes.size, 1);
  });

  test('skips malformed lines and future-version lines', () => {
    const e = ev();
    const good = JSON.stringify({ v: 1, ...e, eventHash: hashEvent(e) }) + '\n';
    const future = JSON.stringify({ v: 99, ...e, eventHash: 'x' }) + '\n';
    const bad = 'not json\n';
    appendFileSync(path.join(tmp, 'events.ndjson'), good + future + bad);

    const state = loadStore();
    assert.equal(state.events.length, 1);
  });
});

describe('appendEvents', () => {
  test('appends new events and returns the new subset', () => {
    const state = loadStore();
    const e1 = ev({ sessionId: 's1' });
    const e2 = ev({ sessionId: 's2' });
    const added = appendEvents(state, [e1, e2]);
    assert.equal(added.length, 2);
    assert.equal(state.events.length, 2);

    const reread = loadStore();
    assert.equal(reread.events.length, 2);
  });

  test('filters duplicates', () => {
    const state = loadStore();
    const e = ev();
    appendEvents(state, [e]);
    const added = appendEvents(state, [e, e, e]);
    assert.equal(added.length, 0);
    assert.equal(state.events.length, 1);
  });

  test('persists the eventHash and v field on disk', () => {
    const state = loadStore();
    appendEvents(state, [ev()]);
    const line = readFileSync(path.join(tmp, 'events.ndjson'), 'utf-8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.v, 1);
    assert.ok(typeof parsed.eventHash === 'string' && parsed.eventHash.length > 0);
  });
});
