import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';
import { resolveProjectRoot } from '../project.js';

const HOME = homedir();

function getClaudePaths(): string[] {
	const envPaths = (process.env.CLAUDE_CONFIG_DIR ?? '').trim();
	if (envPaths !== '') {
		return envPaths
			.split(',')
			.map((p) => p.trim())
			.filter((p) => p !== '')
			.map((p) => path.resolve(p))
			.filter((p) => existsSync(path.join(p, 'projects')));
	}

	const candidates = [
		path.join(process.env.XDG_CONFIG_HOME ?? path.join(HOME, '.config'), 'claude'),
		path.join(HOME, '.claude'),
	];

	return candidates.filter((p) => existsSync(path.join(p, 'projects')));
}

function parseLine(raw: Record<string, unknown>): UnifiedTokenEvent | null {
	if (typeof raw.timestamp !== 'string') return null;

	const message = raw.message as Record<string, unknown> | undefined;
	if (!message) return null;

	const usage = message.usage as Record<string, unknown> | undefined;
	if (!usage) return null;

	const model = String(message.model ?? 'unknown');
	const input = Number(usage.input_tokens ?? 0);
	const output = Number(usage.output_tokens ?? 0);
	if (input === 0 && output === 0) return null;

	return {
		source: 'claude-code',
		timestamp: raw.timestamp,
		sessionId: String(raw.sessionId ?? 'unknown'),
		model,
		tokens: {
			input,
			output,
			cacheCreation: Number(usage.cache_creation_input_tokens ?? 0),
			cacheRead: Number(usage.cache_read_input_tokens ?? 0),
			reasoning: 0,
		},
		costUSD: typeof raw.costUSD === 'number' ? raw.costUSD : 0,
	};
}

export async function loadClaudeEvents(): Promise<UnifiedTokenEvent[]> {
	const claudePaths = getClaudePaths();
	if (claudePaths.length === 0) return [];

	const events: UnifiedTokenEvent[] = [];
	const seen = new Set<string>();

	for (const claudePath of claudePaths) {
		const projectsDir = path.join(claudePath, 'projects');
		const files = await glob('**/*.jsonl', { cwd: projectsDir, absolute: true });

		for (const file of files) {
			let content: string;
			try {
				content = await readFile(file, 'utf-8');
			} catch {
				continue;
			}

			const sessionId = path.basename(file, '.jsonl');

			for (const line of content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				let parsed: Record<string, unknown>;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					continue;
				}

				const event = parseLine(parsed);
				if (!event) continue;

				event.sessionId = sessionId;
				// cwd can change mid-session (user cd's); we honor the cwd at each event.
				const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : undefined;
				if (cwd) {
					event.project = resolveProjectRoot(cwd).name;
				}
				// No fallback: if cwd is absent, event.project stays undefined and the event
				// is excluded from per-project aggregation (but still counts toward totals).

				const requestId = String(parsed.requestId ?? '');
				const messageId = String((parsed.message as Record<string, unknown>)?.id ?? '');
				const dedupeKey = requestId && messageId
					? `${messageId}:${requestId}`
					: `${event.timestamp}:${event.model}:${event.tokens.input}:${event.tokens.output}`;
				if (seen.has(dedupeKey)) continue;
				seen.add(dedupeKey);

				events.push(event);
			}
		}
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
