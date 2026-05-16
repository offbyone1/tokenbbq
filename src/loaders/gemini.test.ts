import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadGeminiEvents } from './gemini.js';

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), 'tbq-gemini-'));
	process.env.GEMINI_DIR = tmp;
	process.env.TOKENBBQ_DATA_DIR = path.join(tmp, 'data');
});
afterEach(() => {
	delete process.env.GEMINI_DIR;
	delete process.env.TOKENBBQ_DATA_DIR;
	rmSync(tmp, { recursive: true, force: true });
});

function writeSession(name: string, sessionId: string, messageId: string): void {
	const dir = path.join(tmp, 'tmp', 'proj', 'chats');
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, name),
		JSON.stringify({
			sessionId,
			messages: [
				{
					id: messageId,
					timestamp: '2026-04-22T14:02:11.812Z',
					model: 'gemini-2.0',
					tokens: { input: 10, output: 20 },
				},
			],
		}),
		'utf-8',
	);
}

describe('loadGeminiEvents', () => {
	test('dedupes the same logical event across multiple session files', async () => {
		// Same sessionId + message id appearing in two files must collapse to
		// one event — dedup is global across files, not per-file.
		writeSession('session-1.json', 'sess', 'm1');
		writeSession('session-2.json', 'sess', 'm1');

		const events = await loadGeminiEvents();
		assert.equal(events.length, 1);
	});
});
