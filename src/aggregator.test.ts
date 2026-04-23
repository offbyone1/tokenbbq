import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByProject } from './aggregator.js';
import type { UnifiedTokenEvent } from './types.js';

function ev(over: Partial<UnifiedTokenEvent> = {}): UnifiedTokenEvent {
  return {
    source: 'claude-code',
    timestamp: '2026-04-20T10:00:00.000Z',
    sessionId: 's',
    model: 'claude-opus-4-7',
    tokens: { input: 100, output: 200, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
    costUSD: 0.5,
    ...over,
  };
}

describe('aggregateByProject', () => {
  test('groups events by project and computes lastActive as latest event date', () => {
    const events = [
      ev({ project: 'TokenBBQ', timestamp: '2026-04-20T10:00:00.000Z' }),
      ev({ project: 'TokenBBQ', timestamp: '2026-04-22T12:00:00.000Z' }),
      ev({ project: 'Particulate', timestamp: '2026-04-21T10:00:00.000Z' }),
    ];
    const out = aggregateByProject(events);
    const tbq = out.find(p => p.project === 'TokenBBQ');
    const part = out.find(p => p.project === 'Particulate');
    assert.ok(tbq && part);
    assert.equal(tbq.lastActive, '2026-04-22');
    assert.equal(part.lastActive, '2026-04-21');
    assert.equal(tbq.eventCount, 2);
  });

  test('sets projectPath equal to project (display name) when no path distinction', () => {
    const out = aggregateByProject([ev({ project: 'X' })]);
    assert.equal(out[0].projectPath, 'X');
  });

  test('events without project are excluded', () => {
    const out = aggregateByProject([ev({ project: undefined })]);
    assert.equal(out.length, 0);
  });

  test('events with empty or whitespace-only project are excluded', () => {
    const out = aggregateByProject([ev({ project: '' }), ev({ project: '   ' })]);
    assert.equal(out.length, 0);
  });

  test('events with project "unknown" (any case) are excluded', () => {
    const out = aggregateByProject([
      ev({ project: 'unknown' }),
      ev({ project: 'Unknown' }),
      ev({ project: 'UNKNOWN' }),
    ]);
    assert.equal(out.length, 0);
  });
});
