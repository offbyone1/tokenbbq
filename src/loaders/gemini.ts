import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';
import { isValidTimestamp } from '../types.js';
import { loadCachedFileRecords } from './cache.js';

const HOME = homedir();
const FALLBACK_MODEL = 'gemini';

type CachedGeminiEvent = {
	dedupeKey: string;
	event: UnifiedTokenEvent;
};

function isCachedGeminiEvent(value: unknown): value is CachedGeminiEvent {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	const event = record.event as Record<string, unknown> | undefined;
	return (
		typeof record.dedupeKey === 'string' &&
		!!event &&
		typeof event.source === 'string' &&
		typeof event.timestamp === 'string' &&
		typeof event.sessionId === 'string' &&
		typeof event.model === 'string' &&
		!!event.tokens &&
		typeof event.tokens === 'object'
	);
}

function getGeminiDir(): string | null {
	const envPath = (process.env.GEMINI_DIR ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(path.join(resolved, 'tmp'))) return resolved;
	}

	const defaultPath = path.join(HOME, '.gemini');
	if (existsSync(path.join(defaultPath, 'tmp'))) return defaultPath;
	return null;
}

function ensureNum(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function looksLikeProjectHash(value: string): boolean {
	return /^[a-f0-9]{32,}$/i.test(value);
}

function inferProjectName(tmpDir: string, file: string): string | undefined {
	const segments = path.relative(tmpDir, file).split(path.sep);
	const candidate = segments[0]?.trim();
	if (!candidate || looksLikeProjectHash(candidate)) return undefined;
	return candidate;
}

export function getGeminiWatchPaths(): string[] {
	const dir = getGeminiDir();
	return dir ? [path.join(dir, 'tmp')] : [];
}

export async function loadGeminiEvents(): Promise<UnifiedTokenEvent[]> {
	const geminiDir = getGeminiDir();
	if (!geminiDir) return [];

	const tmpDir = path.join(geminiDir, 'tmp');
	const files = await glob('**/chats/session-*.json', { cwd: tmpDir, absolute: true });

	const records = await loadCachedFileRecords('gemini', files, async (file) => {
		const fileEvents: CachedGeminiEvent[] = [];
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			return fileEvents;
		}

		let session: Record<string, unknown>;
		try {
			session = JSON.parse(content);
		} catch {
			return fileEvents;
		}

		const sessionId = String(session.sessionId ?? path.basename(file, '.json'));
		const project = inferProjectName(tmpDir, file);
		const messages = Array.isArray(session.messages)
			? (session.messages as Record<string, unknown>[])
			: [];

		for (const msg of messages) {
			const tokens = msg.tokens as Record<string, unknown> | undefined;
			if (!tokens) continue;

			const input = ensureNum(tokens.input);
			const cacheRead = ensureNum(tokens.cached);
			const reasoning = ensureNum(tokens.thoughts);
			const tool = ensureNum(tokens.tool);
			let output = ensureNum(tokens.output) + tool;
			const total = ensureNum(tokens.total);

			// Gemini sessions today record `cached` (cache reads) but no
			// cache-write field. If a future schema starts emitting one of
			// the obvious names, pick it up so it can't quietly fold into
			// `output` via the overflow line below and get charged at the
			// output rate.
			const cacheCreation =
				ensureNum(tokens.cache_creation) ||
				ensureNum(tokens.cacheCreation) ||
				ensureNum(tokens.cacheWrite) ||
				ensureNum(tokens.cache_write);

			const known = input + output + cacheRead + cacheCreation + reasoning;
			if (total > known) output += total - known;
			if (input === 0 && output === 0 && cacheRead === 0 && reasoning === 0) continue;

			if (!isValidTimestamp(msg.timestamp)) continue;
			const timestamp = msg.timestamp;

			const id = String(msg.id ?? '');
			const dedupeKey = id
				? `gemini:${sessionId}:${id}`
				: `gemini:${sessionId}:${timestamp}:${input}:${output}:${cacheRead}:${reasoning}`;

			const model =
				typeof msg.model === 'string' && msg.model.trim() !== ''
					? msg.model
					: FALLBACK_MODEL;

			fileEvents.push({
				dedupeKey,
				event: {
					source: 'gemini',
					timestamp,
					sessionId,
					model,
					tokens: {
						input,
						output,
						cacheCreation,
						cacheRead,
						reasoning,
					},
					costUSD: 0,
					project,
				},
			});
		}
		return fileEvents;
	}, isCachedGeminiEvent);

	// Dedup globally across all files (cached or freshly parsed), not per-file:
	// the same logical message can appear in more than one session file.
	const seen = new Set<string>();
	const events = records.flatMap((record) => {
		if (seen.has(record.dedupeKey)) return [];
		seen.add(record.dedupeKey);
		return [record.event];
	});

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
