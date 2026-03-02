import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';

const HOME = homedir();

function getPiAgentDir(): string | null {
	const envPath = (process.env.PI_AGENT_DIR ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(resolved)) return resolved;
	}
	const defaultPath = path.join(HOME, '.pi', 'agent', 'sessions');
	if (existsSync(defaultPath)) return defaultPath;
	return null;
}

export async function loadPiEvents(): Promise<UnifiedTokenEvent[]> {
	const piDir = getPiAgentDir();
	if (!piDir) return [];

	const files = await glob('**/*.jsonl', { cwd: piDir, absolute: true });
	const events: UnifiedTokenEvent[] = [];
	const seen = new Set<string>();

	for (const file of files) {
		const relPath = path.relative(piDir, file);
		const segments = relPath.split(path.sep);
		const project = segments.length >= 2 ? segments[0] : 'unknown';
		const filename = path.basename(file, '.jsonl');
		const underscoreIdx = filename.indexOf('_');
		const sessionId = underscoreIdx !== -1 ? filename.slice(underscoreIdx + 1) : filename;

		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				continue;
			}

			const type = parsed.type as string | undefined;
			if (type != null && type !== 'message') continue;

			const message = parsed.message as Record<string, unknown> | undefined;
			if (!message || message.role !== 'assistant') continue;

			const usage = message.usage as Record<string, unknown> | undefined;
			if (!usage) continue;

			const input = Number(usage.input ?? 0);
			const output = Number(usage.output ?? 0);
			if (input === 0 && output === 0) continue;

			const timestamp = String(parsed.timestamp ?? new Date().toISOString());
			const dedupeKey = `pi:${timestamp}:${input + output}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);

			const rawModel = String(message.model ?? 'unknown');
			const cost = usage.cost as Record<string, unknown> | undefined;

			events.push({
				source: 'pi',
				timestamp,
				sessionId,
				model: `[pi] ${rawModel}`,
				tokens: {
					input,
					output,
					cacheCreation: Number(usage.cacheWrite ?? 0),
					cacheRead: Number(usage.cacheRead ?? 0),
					reasoning: 0,
				},
				costUSD: typeof cost?.total === 'number' ? cost.total : 0,
				project,
			});
		}
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
