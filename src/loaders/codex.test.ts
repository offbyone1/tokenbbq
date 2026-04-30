import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

	beforeAll(() => {
		tmpHome = mkdtempSync(path.join(tmpdir(), 'codex-test-'));
		mkdirSync(path.join(tmpHome, 'sessions', '2026', '04', '30'), { recursive: true });
		process.env.CODEX_HOME = tmpHome;
	});

	afterAll(() => {
		if (ORIG_HOME === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = ORIG_HOME;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	it('returns null when no sessions exist', async () => {
		const result = await loadCodexRateLimits();
		expect(result).toBeNull();
	});

	it('extracts the latest rate_limits entry from the most recent session', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		const event = (usedPrimary: number, ts: string) => JSON.stringify({
			timestamp: ts,
			type: 'event_msg',
			payload: {
				type: 'token_count',
				info: null,
				rate_limits: {
					limit_id: 'codex',
					limit_name: null,
					primary: { used_percent: usedPrimary, window_minutes: 300, resets_at: 1777521443 },
					secondary: { used_percent: 8.0, window_minutes: 10080, resets_at: 1778051858 },
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
		expect(result).not.toBeNull();
		expect(result!.planType).toBe('plus');
		expect(result!.primary).not.toBeNull();
		expect(result!.primary!.utilization).toBe(38.0);
		expect(result!.primary!.windowMinutes).toBe(300);
		expect(result!.primary!.resetsAt).toBe(new Date(1777521443 * 1000).toISOString());
		expect(result!.secondary!.utilization).toBe(8.0);
		expect(result!.snapshotAt).toBe('2026-04-30T01:40:00.000Z');
	});

	it('handles missing rate_limits gracefully', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		makeSession(dir, 'rollout-empty.jsonl', [
			JSON.stringify({ timestamp: '2026-04-30T02:00:00.000Z', type: 'session_meta', payload: { cwd: '/tmp' } }),
		], 3000); // newer than other fixtures

		const result = await loadCodexRateLimits();
		// Falls back to whichever session DID have rate_limits — the previous "rollout-new"
		expect(result).not.toBeNull();
		expect(result!.snapshotAt).toBe('2026-04-30T01:40:00.000Z');
	});

	it('handles plan_type null (API-key auth)', async () => {
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
		expect(result).not.toBeNull();
		expect(result!.planType).toBeNull();
		expect(result!.primary).toBeNull();
		expect(result!.secondary).toBeNull();
	});
});
