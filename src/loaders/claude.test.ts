import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadClaudeEvents } from './claude.js';

// loadClaudeEvents reads CLAUDE_CONFIG_DIR/projects/**/*.jsonl. We isolate the
// loader cache to a throwaway dir and disable it so each case is deterministic.
let tmpRoot: string;
let projDir: string;
const ORIG_CFG = process.env.CLAUDE_CONFIG_DIR;
const ORIG_DATA = process.env.TOKENBBQ_DATA_DIR;
const ORIG_NOCACHE = process.env.TOKENBBQ_DISABLE_LOADER_CACHE;

function writeSession(name: string, objs: unknown[]): void {
  writeFileSync(
    path.join(projDir, name),
    objs.map((o) => JSON.stringify(o)).join('\n') + '\n',
    'utf-8',
  );
}

const line = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  timestamp: '2026-05-01T10:00:00.000Z',
  sessionId: 's1',
  requestId: 'req-' + Math.random().toString(36).slice(2),
  message: {
    id: 'msg-' + Math.random().toString(36).slice(2),
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  ...over,
});

describe('loadClaudeEvents — ccusage usageDataSchema parity', () => {
  before(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'claude-test-'));
    projDir = path.join(tmpRoot, 'projects', 'proj');
    mkdirSync(projDir, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = tmpRoot;
    process.env.TOKENBBQ_DATA_DIR = path.join(tmpRoot, '.data');
    process.env.TOKENBBQ_DISABLE_LOADER_CACHE = '1';
  });

  after(() => {
    if (ORIG_CFG === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = ORIG_CFG;
    if (ORIG_DATA === undefined) delete process.env.TOKENBBQ_DATA_DIR;
    else process.env.TOKENBBQ_DATA_DIR = ORIG_DATA;
    if (ORIG_NOCACHE === undefined) delete process.env.TOKENBBQ_DISABLE_LOADER_CACHE;
    else process.env.TOKENBBQ_DISABLE_LOADER_CACHE = ORIG_NOCACHE;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(projDir, { recursive: true, force: true });
    mkdirSync(projDir, { recursive: true });
  });

  test('counts a well-formed entry and defaults absent cache fields to 0', async () => {
    writeSession('a.jsonl', [line({
      message: { id: 'm1', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 120, output_tokens: 30 } },
      requestId: 'r1',
    })]);
    const events = await loadClaudeEvents();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].tokens, {
      input: 120, output: 30, cacheCreation: 0, cacheRead: 0, reasoning: 0,
    });
  });

  test('keeps cache token fields when present', async () => {
    writeSession('b.jsonl', [line({
      message: {
        id: 'm2', model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 7, cache_read_input_tokens: 900 },
      },
      requestId: 'r2',
    })]);
    const events = await loadClaudeEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].tokens.cacheCreation, 7);
    assert.equal(events[0].tokens.cacheRead, 900);
  });

  test('drops the entry when input_tokens is a string (== ccusage v.number())', async () => {
    writeSession('c.jsonl', [line({
      message: { id: 'm3', model: 'x', usage: { input_tokens: '100', output_tokens: 50 } },
      requestId: 'r3',
    })]);
    assert.equal((await loadClaudeEvents()).length, 0);
  });

  test('drops the entry when input_tokens is missing (required field)', async () => {
    writeSession('d.jsonl', [line({
      message: { id: 'm4', model: 'x', usage: { output_tokens: 50 } },
      requestId: 'r4',
    })]);
    assert.equal((await loadClaudeEvents()).length, 0);
  });

  test('drops the entry when a present cache field is not a number', async () => {
    writeSession('e.jsonl', [line({
      message: {
        id: 'm5', model: 'x',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 'lots' },
      },
      requestId: 'r5',
    })]);
    assert.equal((await loadClaudeEvents()).length, 0);
  });

  test('drops the entry when a cache field is present but null (valibot v.optional rejects null)', async () => {
    // valibot v.optional(v.number()) only excuses an ABSENT key; a present
    // JSON null is not a number → ccusage drops the whole entry.
    writeSession('e2.jsonl', [line({
      message: {
        id: 'm5b', model: 'x',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null },
      },
      requestId: 'r5b',
    })]);
    assert.equal((await loadClaudeEvents()).length, 0);
  });

  test('keeps a cache-only entry (input=0, output=0, cache_read>0) — ccusage parity', async () => {
    writeSession('f.jsonl', [line({
      message: {
        id: 'm6', model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1500 },
      },
      requestId: 'r6',
    })]);
    const events = await loadClaudeEvents();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].tokens, {
      input: 0, output: 0, cacheCreation: 0, cacheRead: 1500, reasoning: 0,
    });
  });

  test('keeps a pure zero-token entry (ccusage schema accepts 0/0)', async () => {
    writeSession('g.jsonl', [line({
      message: { id: 'm7', model: 'x', usage: { input_tokens: 0, output_tokens: 0 } },
      requestId: 'r7',
    })]);
    assert.equal((await loadClaudeEvents()).length, 1);
  });
});
