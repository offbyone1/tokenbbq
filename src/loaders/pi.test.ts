import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPiEvents } from './pi.js';

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), 'tbq-pi-'));
	process.env.PI_AGENT_DIR = tmp;
	process.env.TOKENBBQ_DATA_DIR = path.join(tmp, 'data');
});
afterEach(() => {
	delete process.env.PI_AGENT_DIR;
	delete process.env.TOKENBBQ_DATA_DIR;
	rmSync(tmp, { recursive: true, force: true });
});

function writeJsonl(rel: string): void {
	const file = path.join(tmp, rel);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(
		file,
		JSON.stringify({
			type: 'message',
			timestamp: '2026-04-22T14:02:11.812Z',
			message: { role: 'assistant', model: 'pi-1', usage: { input: 10, output: 20 } },
		}) + '\n',
		'utf-8',
	);
}

describe('loadPiEvents', () => {
	test('dedupes the same logical event across multiple session files', async () => {
		// pi's dedupe key is timestamp + token total (no file/session in it),
		// so the same event in two files must collapse to one — global, not
		// per-file.
		writeJsonl(path.join('proj', 'a_session-1.jsonl'));
		writeJsonl(path.join('proj', 'b_session-2.jsonl'));

		const events = await loadPiEvents();
		assert.equal(events.length, 1);
	});
});
