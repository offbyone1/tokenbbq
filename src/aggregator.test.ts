import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByProject, buildDashboardData } from './aggregator.js';
import type { CodexRateLimits, UnifiedTokenEvent } from './types.js';

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

  test('perSource breakdown has one entry per contributing source, sorted by tokens desc', () => {
    const events = [
      ev({ project: 'P', source: 'claude-code', tokens: { input: 1000, output: 2000, cacheCreation: 0, cacheRead: 0, reasoning: 0 } }),
      ev({ project: 'P', source: 'claude-code', tokens: { input: 500, output: 1000, cacheCreation: 0, cacheRead: 0, reasoning: 0 } }),
      ev({ project: 'P', source: 'codex', tokens: { input: 100, output: 200, cacheCreation: 0, cacheRead: 0, reasoning: 0 } }),
      ev({ project: 'P', source: 'opencode', tokens: { input: 50, output: 100, cacheCreation: 0, cacheRead: 0, reasoning: 0 } }),
    ];
    const out = aggregateByProject(events);
    const p = out.find(x => x.project === 'P');
    assert.ok(p);
    assert.equal(p.perSource.length, 3);
    // sorted by tokens desc — claude-code first (4500), codex (300), opencode (150)
    assert.equal(p.perSource[0].source, 'claude-code');
    assert.equal(p.perSource[1].source, 'codex');
    assert.equal(p.perSource[2].source, 'opencode');
    assert.equal(p.perSource[0].eventCount, 2);
    assert.equal(p.perSource[1].eventCount, 1);
    // token sums match
    const cc = p.perSource[0];
    assert.equal(cc.tokens.input, 1500);
    assert.equal(cc.tokens.output, 3000);
  });

  test('perSource cost sums correctly per source', () => {
    const events = [
      ev({ project: 'Q', source: 'claude-code', costUSD: 1.5 }),
      ev({ project: 'Q', source: 'claude-code', costUSD: 2.5 }),
      ev({ project: 'Q', source: 'codex', costUSD: 0.75 }),
    ];
    const out = aggregateByProject(events);
    const p = out.find(x => x.project === 'Q');
    assert.ok(p);
    const cc = p.perSource.find(s => s.source === 'claude-code');
    const cx = p.perSource.find(s => s.source === 'codex');
    assert.equal(cc?.costUSD, 4);
    assert.equal(cx?.costUSD, 0.75);
  });
});

describe('buildDashboardData', () => {
  test('passes through codexRateLimits unchanged when provided', () => {
    const limits: CodexRateLimits = {
      planType: 'plus',
      primary: { utilization: 38, windowMinutes: 300, resetsAt: '2026-04-30T05:57:23.000Z' },
      secondary: { utilization: 11, windowMinutes: 10080, resetsAt: '2026-05-06T09:17:38.000Z' },
      snapshotAt: '2026-04-30T01:38:47.383Z',
    };
    const out = buildDashboardData([], limits);
    assert.equal(out.codexRateLimits, limits);
  });

  test('defaults codexRateLimits to null when omitted', () => {
    const out = buildDashboardData([]);
    assert.equal(out.codexRateLimits, null);
  });
});
