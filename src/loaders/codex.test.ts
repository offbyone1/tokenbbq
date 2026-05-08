import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCodexEvents, loadCodexRateLimits, normalizeUsage, subtractUsage, type RawUsage } from './codex.js';

function makeSession(dir: string, name: string, lines: string[], mtimeSec?: number): string {
	const file = path.join(dir, name);
	writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
	if (mtimeSec !== undefined) {
		utimesSync(file, mtimeSec, mtimeSec);
	}
	return file;
}

describe('normalizeUsage', () => {
  test('reads OpenAI field names and fills total when missing', () => {
    const u = normalizeUsage({
      input_tokens: 100,
      cached_input_tokens: 30,
      output_tokens: 50,
      reasoning_output_tokens: 10,
    });
    assert.deepEqual(u, {
      input: 100, cached: 30, output: 50, reasoning: 10,
      // total absent → fallback to input + output, NOT including cached/reasoning
      total: 150,
    });
  });

  test('honors total_tokens when provided', () => {
    const u = normalizeUsage({
      input_tokens: 100, output_tokens: 50, total_tokens: 175,
    });
    assert.equal(u?.total, 175);
  });

  test('falls back to cache_read_input_tokens for cached', () => {
    const u = normalizeUsage({
      input_tokens: 100,
      cache_read_input_tokens: 40,
      output_tokens: 50,
    });
    assert.equal(u?.cached, 40);
  });

  test('returns null for non-objects', () => {
    assert.equal(normalizeUsage(null), null);
    assert.equal(normalizeUsage(undefined), null);
    assert.equal(normalizeUsage(42), null);
    assert.equal(normalizeUsage('x'), null);
  });
});

describe('subtractUsage — cumulative-total math', () => {
  const usage = (over: Partial<RawUsage> = {}): RawUsage => ({
    input: 0, cached: 0, output: 0, reasoning: 0, total: 0, ...over,
  });

  test('returns the current usage as-is when prev is null (first turn)', () => {
    const cur = usage({ input: 100, output: 50, total: 150 });
    assert.deepEqual(subtractUsage(cur, null), cur);
  });

  test('subtracts each field independently across turns', () => {
    const turn1 = usage({ input: 100, cached: 20, output: 50, reasoning: 5, total: 175 });
    const turn2Cumulative = usage({ input: 250, cached: 80, output: 120, reasoning: 15, total: 465 });
    const fresh = subtractUsage(turn2Cumulative, turn1);
    assert.deepEqual(fresh, {
      input: 150, cached: 60, output: 70, reasoning: 10, total: 290,
    });
  });

  test('clamps negative deltas to 0 (rare schema-glitch guard)', () => {
    // If a session log emits an out-of-order or downward-counting entry,
    // never subtract into negative — Math.max(.., 0) keeps the event sane
    // but signals nothing was added on this turn.
    const prev = usage({ input: 100, output: 50, total: 150 });
    const cur = usage({ input: 90, output: 50, total: 140 });
    const fresh = subtractUsage(cur, prev);
    assert.deepEqual(fresh, {
      input: 0, cached: 0, output: 0, reasoning: 0, total: 0,
    });
  });

  test('three-turn cumulative chain produces per-turn deltas', () => {
    // Codex emits cumulative totals, the loader reduces them via successive
    // subtractUsage calls. Each call must yield only the new tokens since
    // the previous call.
    const t1 = usage({ input: 100, output: 50, total: 150 });
    const t2 = usage({ input: 220, output: 130, total: 350 });
    const t3 = usage({ input: 320, output: 200, total: 520 });

    const f1 = subtractUsage(t1, null);
    const f2 = subtractUsage(t2, t1);
    const f3 = subtractUsage(t3, t2);

    assert.equal(f1.input + f2.input + f3.input, t3.input);
    assert.equal(f1.output + f2.output + f3.output, t3.output);
    assert.equal(f1.total + f2.total + f3.total, t3.total);
    assert.deepEqual(f2, { input: 120, cached: 0, output: 80, reasoning: 0, total: 200 });
  });
});

describe('loadCodexRateLimits', () => {
	let tmpHome: string;
	const ORIG_HOME = process.env.CODEX_HOME;

	before(() => {
		tmpHome = mkdtempSync(path.join(tmpdir(), 'codex-test-'));
		mkdirSync(path.join(tmpHome, 'sessions', '2026', '04', '30'), { recursive: true });
		process.env.CODEX_HOME = tmpHome;
	});

	after(() => {
		if (ORIG_HOME === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = ORIG_HOME;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	test('returns null when no sessions exist', async () => {
		const result = await loadCodexRateLimits();
		assert.strictEqual(result, null);
	});

	test('extracts the latest rate_limits entry from the most recent session', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		// Use a reset time far in the future so the stale-window logic
		// doesn't kick in for this test — we want to assert the raw
		// extracted value, not the staleness fallback.
		const future5h = Math.floor(Date.now() / 1000) + 3600;
		const future7d = Math.floor(Date.now() / 1000) + 7 * 86400;
		const event = (usedPrimary: number, ts: string) => JSON.stringify({
			timestamp: ts,
			type: 'event_msg',
			payload: {
				type: 'token_count',
				info: null,
				rate_limits: {
					limit_id: 'codex',
					limit_name: null,
					primary: { used_percent: usedPrimary, window_minutes: 300, resets_at: future5h },
					secondary: { used_percent: 8.0, window_minutes: 10080, resets_at: future7d },
					credits: null,
					plan_type: 'plus',
					rate_limit_reached_type: null,
				},
			},
		});

		// Older session — should be ignored
		makeSession(dir, 'rollout-old.jsonl', [event(5.0, '2026-04-30T01:00:00.000Z')], 1000);
		// Newer session — within it, last rate_limits entry wins
		makeSession(dir, 'rollout-new.jsonl', [
			event(20.0, '2026-04-30T01:30:00.000Z'),
			event(38.0, '2026-04-30T01:40:00.000Z'),
		], 2000);

		const result = await loadCodexRateLimits();
		assert.notStrictEqual(result, null);
		assert.strictEqual(result!.planType, 'plus');
		assert.notStrictEqual(result!.primary, null);
		assert.strictEqual(result!.primary!.utilization, 38.0);
		assert.strictEqual(result!.primary!.windowMinutes, 300);
		assert.strictEqual(result!.primary!.resetsAt, new Date(future5h * 1000).toISOString());
		assert.strictEqual(result!.secondary!.utilization, 8.0);
		assert.strictEqual(result!.snapshotAt, '2026-04-30T01:40:00.000Z');
	});

	test('handles missing rate_limits gracefully', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		makeSession(dir, 'rollout-empty.jsonl', [
			JSON.stringify({ timestamp: '2026-04-30T02:00:00.000Z', type: 'session_meta', payload: { cwd: '/tmp' } }),
		], 3000); // newer than other fixtures

		const result = await loadCodexRateLimits();
		// Falls back to whichever session DID have rate_limits — the previous "rollout-new"
		assert.notStrictEqual(result, null);
		assert.strictEqual(result!.snapshotAt, '2026-04-30T01:40:00.000Z');
	});

	test('handles plan_type null (API-key auth)', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		makeSession(dir, 'rollout-apikey.jsonl', [JSON.stringify({
			timestamp: '2026-04-30T03:00:00.000Z',
			type: 'event_msg',
			payload: {
				type: 'token_count',
				rate_limits: { primary: null, secondary: null, plan_type: null },
			},
		})], 4000);

		const result = await loadCodexRateLimits();
		assert.notStrictEqual(result, null);
		assert.strictEqual(result!.planType, null);
		assert.strictEqual(result!.primary, null);
		assert.strictEqual(result!.secondary, null);
	});

	test('zeroes utilization when the snapshot reset is in the past', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		const past = Math.floor(Date.now() / 1000) - 3600; // 1h ago
		// Use the highest mtime so this fixture is selected as newest.
		makeSession(dir, 'rollout-stale.jsonl', [JSON.stringify({
			timestamp: '2026-04-30T05:00:00.000Z',
			type: 'event_msg',
			payload: {
				type: 'token_count',
				rate_limits: {
					primary: { used_percent: 94.0, window_minutes: 300, resets_at: past },
					secondary: { used_percent: 28.0, window_minutes: 10080, resets_at: past },
					plan_type: 'plus',
				},
			},
		})], 9000);

		const result = await loadCodexRateLimits();
		assert.notStrictEqual(result, null);
		// Snapshot's window has rolled over since it was written → show 0%.
		assert.strictEqual(result!.primary!.utilization, 0);
		assert.strictEqual(result!.secondary!.utilization, 0);
		// resetsAt is nulled when stale so the pill falls back to "5h"/"7d".
		assert.strictEqual(result!.primary!.resetsAt, null);
		assert.strictEqual(result!.secondary!.resetsAt, null);
	});
});

describe('loadCodexEvents', () => {
	let tmpHome: string;
	const ORIG_HOME = process.env.CODEX_HOME;

	before(() => {
		tmpHome = mkdtempSync(path.join(tmpdir(), 'codex-events-test-'));
		mkdirSync(path.join(tmpHome, 'sessions', '2026', '04', '30'), { recursive: true });
		process.env.CODEX_HOME = tmpHome;
	});

	after(() => {
		if (ORIG_HOME === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = ORIG_HOME;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	test('emits per-turn deltas via subtractUsage and splits cached input', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		// Codex emits cumulative `total_token_usage` per turn. The loader uses
		// subtractUsage(currTotal, prevTotal) to derive per-turn deltas. The
		// cached portion is split out of `input` so `tokens.input` is fresh-only.
		makeSession(dir, 'rollout-usage.jsonl', [
			JSON.stringify({
				timestamp: '2026-04-30T10:00:00.000Z',
				type: 'turn_context',
				payload: { model: 'gpt-5.5' },
			}),
			JSON.stringify({
				timestamp: '2026-04-30T10:00:01.000Z',
				type: 'event_msg',
				payload: {
					type: 'token_count',
					info: {
						total_token_usage: {
							input_tokens: 1000,
							cached_input_tokens: 700,
							output_tokens: 100,
							reasoning_output_tokens: 20,
							total_tokens: 1100,
						},
						last_token_usage: {
							input_tokens: 1000,
							cached_input_tokens: 700,
							output_tokens: 100,
							reasoning_output_tokens: 20,
							total_tokens: 1100,
						},
					},
				},
			}),
			JSON.stringify({
				timestamp: '2026-04-30T10:00:02.000Z',
				type: 'event_msg',
				payload: {
					type: 'token_count',
					info: {
						total_token_usage: {
							input_tokens: 1200,
							cached_input_tokens: 800,
							output_tokens: 110,
							reasoning_output_tokens: 25,
							total_tokens: 1310,
						},
						last_token_usage: {
							input_tokens: 200,
							cached_input_tokens: 100,
							output_tokens: 10,
							reasoning_output_tokens: 5,
							total_tokens: 210,
						},
					},
				},
			}),
		], 1000);

		const events = await loadCodexEvents();
		assert.equal(events.length, 2);
		// First turn: prev is null, so raw = lastUsage = (1000, cached 700, 100, 20).
		// fresh = 1000 - 700 = 300, cacheRead = 700.
		assert.deepEqual(events[0].tokens, {
			input: 300,
			output: 100,
			cacheCreation: 0,
			cacheRead: 700,
			reasoning: 20,
		});
		// Second turn: raw = total2 - total1 = (200, 100, 10, 5).
		// fresh = 200 - 100 = 100, cacheRead = 100.
		assert.deepEqual(events[1].tokens, {
			input: 100,
			output: 10,
			cacheCreation: 0,
			cacheRead: 100,
			reasoning: 5,
		});
	});
});
