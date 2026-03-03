import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';

const HOME = homedir();
const FALLBACK_MODEL = 'antigravity-planner';
const REQUEST_LINE = /Requesting planner with (\d+) chat messages/i;
const TIMESTAMP_PREFIX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;

function resolveLogsDir(basePath: string): string | null {
	if (existsSync(path.join(basePath, 'logs'))) return path.join(basePath, 'logs');
	if (existsSync(basePath)) return basePath;
	return null;
}

function getAntigravityLogsDir(): string | null {
	const envPath = (process.env.ANTIGRAVITY_LOGS_DIR ?? process.env.ANTIGRAVITY_DIR ?? '').trim();
	if (envPath !== '') {
		const resolved = resolveLogsDir(path.resolve(envPath));
		if (resolved) return resolved;
	}

	const appData = (process.env.APPDATA ?? '').trim();
	if (appData !== '') {
		const windowsBase = path.join(appData, 'Antigravity', 'logs');
		const resolved = resolveLogsDir(windowsBase);
		if (resolved) return resolved;
	}

	const fallbackBase = path.join(HOME, '.config', 'Antigravity', 'logs');
	return resolveLogsDir(fallbackBase);
}

function parseTimestamp(line: string): string | null {
	const match = line.match(TIMESTAMP_PREFIX);
	if (!match?.[1]) return null;

	const localIso = `${match[1].replace(' ', 'T')}Z`;
	const parsed = new Date(localIso);
	if (Number.isNaN(parsed.getTime())) return null;
	return localIso;
}

function inferSessionId(logsDir: string, file: string): string {
	const segments = path.relative(logsDir, file).split(path.sep);
	return segments[0] ?? path.basename(path.dirname(file));
}

export async function loadAntigravityEvents(): Promise<UnifiedTokenEvent[]> {
	const logsDir = getAntigravityLogsDir();
	if (!logsDir) return [];

	const files = await glob('**/google.antigravity/Antigravity.log', {
		cwd: logsDir,
		absolute: true,
	});
	if (files.length === 0) return [];

	const events: UnifiedTokenEvent[] = [];
	const seen = new Set<string>();

	for (const file of files) {
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		const sessionId = inferSessionId(logsDir, file);

		for (const [index, line] of content.split(/\r?\n/).entries()) {
			const requestMatch = line.match(REQUEST_LINE);
			if (!requestMatch?.[1]) continue;

			const timestamp = parseTimestamp(line);
			if (!timestamp) continue;

			const input = Number(requestMatch[1]);
			if (!Number.isFinite(input) || input <= 0) continue;

			const dedupeKey = `${sessionId}:${index}:${timestamp}:${input}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);

			events.push({
				source: 'antigravity',
				timestamp,
				sessionId,
				model: FALLBACK_MODEL,
				tokens: {
					input,
					output: 0,
					cacheCreation: 0,
					cacheRead: 0,
					reasoning: 0,
				},
				costUSD: 0,
			});
		}
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
