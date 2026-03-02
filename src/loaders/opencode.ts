import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';

const HOME = homedir();

function getOpenCodePath(): string | null {
	const envPath = (process.env.OPENCODE_DATA_DIR ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(resolved)) return resolved;
	}
	const defaultPath = path.join(HOME, '.local', 'share', 'opencode');
	if (existsSync(defaultPath)) return defaultPath;
	return null;
}

export async function loadOpenCodeEvents(): Promise<UnifiedTokenEvent[]> {
	const basePath = getOpenCodePath();
	if (!basePath) return [];

	const messagesDir = path.join(basePath, 'storage', 'message');
	if (!existsSync(messagesDir)) return [];

	const files = await glob('**/*.json', { cwd: messagesDir, absolute: true });
	const events: UnifiedTokenEvent[] = [];
	const seen = new Set<string>();

	for (const file of files) {
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(content);
		} catch {
			continue;
		}

		const id = String(msg.id ?? '');
		if (!id || seen.has(id)) continue;
		seen.add(id);

		const providerID = msg.providerID as string | undefined;
		const modelID = msg.modelID as string | undefined;
		if (!providerID || !modelID) continue;

		const tokens = msg.tokens as Record<string, unknown> | undefined;
		if (!tokens) continue;

		const input = Number(tokens.input ?? 0);
		const output = Number(tokens.output ?? 0);
		if (input === 0 && output === 0) continue;

		const cache = tokens.cache as Record<string, unknown> | undefined;
		const time = msg.time as Record<string, unknown> | undefined;
		const createdMs = Number(time?.created ?? Date.now());

		events.push({
			source: 'opencode',
			timestamp: new Date(createdMs).toISOString(),
			sessionId: String(msg.sessionID ?? 'unknown'),
			model: modelID,
			tokens: {
				input,
				output,
				cacheCreation: Number(cache?.write ?? 0),
				cacheRead: Number(cache?.read ?? 0),
				reasoning: Number(tokens.reasoning ?? 0),
			},
			costUSD: typeof msg.cost === 'number' ? msg.cost : 0,
		});
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
