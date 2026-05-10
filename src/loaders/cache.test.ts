import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCachedFileEvents } from './cache.js';
import type { UnifiedTokenEvent } from '../types.js';

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), 'tbq-loader-cache-'));
	process.env.TOKENBBQ_DATA_DIR = path.join(tmp, 'data');
});

afterEach(() => {
	delete process.env.TOKENBBQ_DATA_DIR;
	delete process.env.TOKENBBQ_DISABLE_LOADER_CACHE;
	rmSync(tmp, { recursive: true, force: true });
});

function event(sessionId: string): UnifiedTokenEvent {
	return {
		source: 'codex',
		timestamp: '2026-04-22T14:02:11.812Z',
		sessionId,
		model: 'gpt-5',
		tokens: { input: 1, output: 2, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
		costUSD: 0,
	};
}

describe('loadCachedFileEvents', () => {
	test('reuses parsed events while file mtime and size are unchanged', async () => {
		const file = path.join(tmp, 'session.jsonl');
		writeFileSync(file, 'first', 'utf-8');
		let parses = 0;

		const parseFile = async (target: string): Promise<UnifiedTokenEvent[]> => {
			parses++;
			return [event(readFileSync(target, 'utf-8'))];
		};

		assert.equal((await loadCachedFileEvents('codex', [file], parseFile))[0]?.sessionId, 'first');
		assert.equal((await loadCachedFileEvents('codex', [file], parseFile))[0]?.sessionId, 'first');
		assert.equal(parses, 1);

		writeFileSync(file, 'second-value', 'utf-8');
		assert.equal((await loadCachedFileEvents('codex', [file], parseFile))[0]?.sessionId, 'second-value');
		assert.equal(parses, 2);
	});
});
