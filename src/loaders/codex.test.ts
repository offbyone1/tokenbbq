import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCodexRateLimits } from './codex.js';

function makeSession(dir: string, name: string, lines: string[], mtimeSec?: number): string {
	const file = path.join(dir, name);
	writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
	if (mtimeSec !== undefined) {
		utimesSync(file, mtimeSec, mtimeSec);
	}
	return file;
}

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
