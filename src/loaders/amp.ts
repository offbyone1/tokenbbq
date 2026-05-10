import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';
import { isValidTimestamp } from '../types.js';
import { getPlatformDataDirs } from '../platform-paths.js';
import { loadCachedFileEvents } from './cache.js';

function getAmpPath(): string | null {
	const envPath = (process.env.AMP_DATA_DIR ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(path.join(resolved, 'threads'))) return resolved;
	}
	for (const candidate of getPlatformDataDirs('amp')) {
		if (existsSync(path.join(candidate, 'threads'))) return candidate;
	}
	return null;
}

export function getAmpWatchPaths(): string[] {
	const ampPath = getAmpPath();
	return ampPath ? [path.join(ampPath, 'threads')] : [];
}

export async function loadAmpEvents(): Promise<UnifiedTokenEvent[]> {
	const ampPath = getAmpPath();
	if (!ampPath) return [];

	const threadsDir = path.join(ampPath, 'threads');
	if (!existsSync(threadsDir)) return [];

	const files = await glob('**/*.json', { cwd: threadsDir, absolute: true });

	const events = await loadCachedFileEvents('amp', files, async (file) => {
		const fileEvents: UnifiedTokenEvent[] = [];
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			return fileEvents;
		}

		let thread: Record<string, unknown>;
		try {
			thread = JSON.parse(content);
		} catch {
			return fileEvents;
		}

		const threadId = String(thread.id ?? path.basename(file, '.json'));
		const ledger = thread.usageLedger as Record<string, unknown> | undefined;
		const ledgerEvents = (ledger?.events ?? []) as Record<string, unknown>[];
		const messages = (thread.messages ?? []) as Record<string, unknown>[];

		for (const evt of ledgerEvents) {
			// Skip events without a valid timestamp. Falling back to `now()` here
			// (the previous behavior) generated a fresh, unique synthetic
			// timestamp on every scan, so dedup never matched and the same
			// real-world event accumulated unbounded across scans.
			if (!isValidTimestamp(evt.timestamp)) continue;

			const tokens = evt.tokens as Record<string, unknown> | undefined;
			const inputTokens = Number(tokens?.input ?? 0);
			const outputTokens = Number(tokens?.output ?? 0);
			if (inputTokens === 0 && outputTokens === 0) continue;

			const toMessageId = evt.toMessageId;
			let cacheCreation = 0;
			let cacheRead = 0;
			if (toMessageId != null) {
				// Amp's `toMessageId` is sometimes a number, sometimes a string,
				// and `messageId` on the matching assistant message can disagree
				// per-version. Strict `===` would silently miss every match and
				// zero out cache tokens for the entire thread; coerce both to
				// String() to compare value-only.
				const target = String(toMessageId);
				const assistantMsg = messages.find(
					(m) => m.role === 'assistant' && String(m.messageId) === target,
				);
				const usage = assistantMsg?.usage as Record<string, unknown> | undefined;
				if (usage) {
					cacheCreation = Number(usage.cacheCreationInputTokens ?? 0);
					cacheRead = Number(usage.cacheReadInputTokens ?? 0);
				}
			}

			fileEvents.push({
				source: 'amp',
				timestamp: evt.timestamp,
				sessionId: threadId,
				model: String(evt.model ?? 'unknown'),
				tokens: {
					input: inputTokens,
					output: outputTokens,
					cacheCreation,
					cacheRead,
					reasoning: 0,
				},
				costUSD: 0,
			});
		}
		return fileEvents;
	});

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
