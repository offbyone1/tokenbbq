import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';

const HOME = homedir();

function getAmpPath(): string | null {
	const envPath = (process.env.AMP_DATA_DIR ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(resolved)) return resolved;
	}
	const defaultPath = path.join(HOME, '.local', 'share', 'amp');
	if (existsSync(defaultPath)) return defaultPath;
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
	const events: UnifiedTokenEvent[] = [];

	for (const file of files) {
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		let thread: Record<string, unknown>;
		try {
			thread = JSON.parse(content);
		} catch {
			continue;
		}

		const threadId = String(thread.id ?? path.basename(file, '.json'));
		const ledger = thread.usageLedger as Record<string, unknown> | undefined;
		const ledgerEvents = (ledger?.events ?? []) as Record<string, unknown>[];
		const messages = (thread.messages ?? []) as Record<string, unknown>[];

		for (const evt of ledgerEvents) {
			const tokens = evt.tokens as Record<string, unknown> | undefined;
			const inputTokens = Number(tokens?.input ?? 0);
			const outputTokens = Number(tokens?.output ?? 0);
			if (inputTokens === 0 && outputTokens === 0) continue;

			const toMessageId = evt.toMessageId as number | undefined;
			let cacheCreation = 0;
			let cacheRead = 0;
			if (toMessageId != null) {
				const assistantMsg = messages.find(
					(m) => m.role === 'assistant' && m.messageId === toMessageId,
				);
				const usage = assistantMsg?.usage as Record<string, unknown> | undefined;
				if (usage) {
					cacheCreation = Number(usage.cacheCreationInputTokens ?? 0);
					cacheRead = Number(usage.cacheReadInputTokens ?? 0);
				}
			}

			events.push({
				source: 'amp',
				timestamp: String(evt.timestamp ?? new Date().toISOString()),
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
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
