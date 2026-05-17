import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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

function legacyPath(): string {
  return path.join(tmp, 'events.ndjson');
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
  test('creates a per-process file when none exists', () => {
    const state = loadStore();
    assert.equal(state.events.length, 0);
    assert.equal(state.hashes.size, 0);
    // path is now per-process, lives under events/
    assert.ok(state.path.includes(path.join(tmp, 'events') + path.sep));
    assert.ok(state.path.endsWith('.ndjson'));
    assert.ok(existsSync(state.path));
  });

  test('reads legacy single-file events.ndjson for migration', () => {
    const e = ev();
    const h = hashEvent(e);
    const line = JSON.stringify({ v: 1, ...e, eventHash: h }) + '\n';
    appendFileSync(legacyPath(), line + line + line);

    const state = loadStore();
    assert.equal(state.events.length, 1);
    assert.equal(state.hashes.size, 1);
  });

  test('reads multiple per-process files and dedups by content hash across files', () => {
    const eventsDir = path.join(tmp, 'events');
    mkdirSync(eventsDir, { recursive: true });

    const e1 = ev({ sessionId: 'a' });
    const e2 = ev({ sessionId: 'b' });
    const lineE1 = JSON.stringify({ v: 1, ...e1, eventHash: hashEvent(e1) }) + '\n';
    const lineE2 = JSON.stringify({ v: 1, ...e2, eventHash: hashEvent(e2) }) + '\n';

    // Process A wrote e1 and e2 (overlap with B below)
    appendFileSync(path.join(eventsDir, 'events-host-1.ndjson'), lineE1 + lineE2);
    // Process B raced and persisted e1 too — dedup must collapse to one
    appendFileSync(path.join(eventsDir, 'events-host-2.ndjson'), lineE1);

    const state = loadStore();
    assert.equal(state.events.length, 2);
  });

  test('skips malformed lines and future-version lines', () => {
    const e = ev();
    const good = JSON.stringify({ v: 1, ...e, eventHash: hashEvent(e) }) + '\n';
    const future = JSON.stringify({ v: 99, ...e, eventHash: 'x' }) + '\n';
    const bad = 'not json\n';
    appendFileSync(legacyPath(), good + future + bad);

    const state = loadStore();
    assert.equal(state.events.length, 1);
  });

  test('rejects a NaN-poisoned token line (serializes to null on disk)', () => {
    const good = ev({ sessionId: 'ok' });
    const goodLine = JSON.stringify({ v: 1, ...good, eventHash: hashEvent(good) }) + '\n';
    // A pre-fix loader could let NaN into tokens.input; JSON.stringify turns
    // NaN into null, so the persisted line carries `"input": null`. loadStore
    // must drop it instead of summing null/NaN into every aggregate.
    const poisoned = ev({ sessionId: 'bad' });
    const poisonedLine = JSON.stringify({
      v: 1, ...poisoned,
      tokens: { ...poisoned.tokens, input: null },
      eventHash: 'x',
    }) + '\n';
    appendFileSync(legacyPath(), goodLine + poisonedLine);

    const state = loadStore();
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].sessionId, 'ok');
  });

  test('ignores a poisoned cache written by the pre-fix version', () => {
    const eventsDir = path.join(tmp, 'events');
    mkdirSync(eventsDir, { recursive: true });

    const a = ev({ sessionId: 'a' });
    const b = ev({ sessionId: 'b' });
    const file = path.join(eventsDir, 'events-host-1.ndjson');
    appendFileSync(
      file,
      JSON.stringify({ v: 1, ...a, eventHash: hashEvent(a) }) + '\n' +
        JSON.stringify({ v: 1, ...b, eventHash: hashEvent(b) }) + '\n',
    );

    // The old buggy appendEvents() could persist a cache whose file metadata
    // matches the real file but whose event list is incomplete (missing b).
    // Such a cache must not be trusted after upgrade — neither at the old
    // store-v1 path nor via the version field.
    const s = statSync(file);
    const meta = [{ path: file, mtimeMs: s.mtimeMs, size: s.size }];
    const cacheDir = path.join(tmp, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      path.join(cacheDir, 'store-v1.json'),
      JSON.stringify({ v: 1, files: meta, events: [a] }),
      'utf-8',
    );
    writeFileSync(
      path.join(cacheDir, 'store-v2.json'),
      JSON.stringify({ v: 1, files: meta, events: [a] }),
      'utf-8',
    );

    const state = loadStore();
    assert.deepEqual(state.events.map((e) => e.sessionId).sort(), ['a', 'b']);
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
    const line = readFileSync(state.path, 'utf-8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.v, 1);
    assert.ok(typeof parsed.eventHash === 'string' && parsed.eventHash.length > 0);
  });

  test('writes only to the per-process file, not to the legacy path', () => {
    const state = loadStore();
    appendEvents(state, [ev()]);
    assert.ok(!existsSync(legacyPath()), 'legacy events.ndjson should not be created');
    assert.ok(state.path !== legacyPath(), 'state.path must be the per-process file');
  });

  test('does not persist a stale read-cache that hides another state\'s events', () => {
    // Two loaded store states race on appends. A stale state writing the
    // read-cache must not drop events a fresher state already persisted.
    const a = ev({ sessionId: 'a' });
    const b = ev({ sessionId: 'b' });
    const c = ev({ sessionId: 'c' });

    const stateA = loadStore();
    appendEvents(stateA, [a]);

    const stateB = loadStore(); // sees a
    appendEvents(stateB, [b]);

    appendEvents(stateA, [c]); // stale stateA appends; must not bury b

    const reread = loadStore();
    assert.deepEqual(
      reread.events.map((e) => e.sessionId).sort(),
      ['a', 'b', 'c'],
    );
  });
});
