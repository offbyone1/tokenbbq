import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';

const HOME = homedir();
const FALLBACK_MODEL = 'gemini';

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
	const events: UnifiedTokenEvent[] = [];
	const seen = new Set<string>();

	for (const file of files) {
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		let session: Record<string, unknown>;
		try {
			session = JSON.parse(content);
		} catch {
			continue;
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

			const known = input + output + cacheRead + reasoning;
			if (total > known) output += total - known;
			if (input === 0 && output === 0 && cacheRead === 0 && reasoning === 0) continue;

			const timestamp = typeof msg.timestamp === 'string' ? msg.timestamp : null;
			if (!timestamp) continue;

			const id = String(msg.id ?? '');
			const dedupeKey = id
				? `gemini:${sessionId}:${id}`
				: `gemini:${sessionId}:${timestamp}:${input}:${output}:${cacheRead}:${reasoning}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);

			const model =
				typeof msg.model === 'string' && msg.model.trim() !== ''
					? msg.model
					: FALLBACK_MODEL;

			events.push({
				source: 'gemini',
				timestamp,
				sessionId,
				model,
				tokens: {
					input,
					output,
					cacheCreation: 0,
					cacheRead,
					reasoning,
				},
				costUSD: 0,
				project,
			});
		}
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
