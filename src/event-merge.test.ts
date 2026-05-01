import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFreshSourceEvents } from './event-merge.js';
import type { UnifiedTokenEvent } from './types.js';

function ev(over: Partial<UnifiedTokenEvent> = {}): UnifiedTokenEvent {
  return {
    source: 'codex',
    timestamp: '2026-04-30T10:00:00.000Z',
    sessionId: 's',
    model: 'gpt-5.5',
    tokens: { input: 100, output: 20, cacheCreation: 0, cacheRead: 50, reasoning: 0 },
    costUSD: 0,
    ...over,
  };
}

describe('mergeFreshSourceEvents', () => {
  test('uses freshly scanned Codex events instead of stale stored Codex events', () => {
    const stored = [
      ev({ sessionId: 'old-codex', tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 1, reasoning: 0 } }),
      ev({ source: 'claude-code', sessionId: 'stored-claude' }),
    ];
    const scanned = [
      ev({ sessionId: 'fresh-codex', tokens: { input: 300, output: 80, cacheCreation: 0, cacheRead: 600, reasoning: 10 } }),
      ev({ source: 'claude-code', sessionId: 'scanned-claude' }),
    ];

    const merged = mergeFreshSourceEvents(stored, scanned, ['codex']);

    assert.deepEqual(merged.map(e => e.sessionId), ['stored-claude', 'fresh-codex']);
  });
});
