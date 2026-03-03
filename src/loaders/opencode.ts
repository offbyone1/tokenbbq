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

function parseOpenCodeEvent(
	msg: Record<string, unknown>,
	fallbackSessionId?: string,
	fallbackCreatedMs?: number,
): UnifiedTokenEvent | null {
	const sessionId = String(msg.sessionID ?? fallbackSessionId ?? '');
	if (!sessionId) return null;

	const providerID = msg.providerID as string | undefined;
	const modelID = msg.modelID as string | undefined;
	if (!providerID || !modelID) return null;

	const tokens = msg.tokens as Record<string, unknown> | undefined;
	if (!tokens) return null;

	const input = Number(tokens.input ?? 0);
	const output = Number(tokens.output ?? 0);
	const cache = tokens.cache as Record<string, unknown> | undefined;
	const cacheCreation = Number(cache?.write ?? 0);
	const cacheRead = Number(cache?.read ?? 0);
	const reasoning = Number(tokens.reasoning ?? 0);
	if (input === 0 && output === 0 && cacheCreation === 0 && cacheRead === 0 && reasoning === 0) return null;

	const time = msg.time as Record<string, unknown> | undefined;
	const createdMs = Number(time?.created ?? fallbackCreatedMs ?? Date.now());

	return {
		source: 'opencode',
		timestamp: new Date(createdMs).toISOString(),
		sessionId,
		model: modelID,
		tokens: {
			input,
			output,
			cacheCreation,
			cacheRead,
			reasoning,
		},
		costUSD: typeof msg.cost === 'number' ? msg.cost : 0,
	};
}

async function loadOpenCodeEventsFromDb(dbPath: string): Promise<UnifiedTokenEvent[] | null> {
	if (!existsSync(dbPath)) return null;

	try {
		const { DatabaseSync } = await import('node:sqlite');
		const db = new DatabaseSync(dbPath, { readOnly: true });
		try {
			const rows = db
				.prepare('SELECT session_id, time_created, data FROM message ORDER BY time_created ASC')
				.all() as Array<{ session_id: string; time_created: number; data: string }>;
			const events: UnifiedTokenEvent[] = [];

			for (const row of rows) {
				let msg: Record<string, unknown>;
				try {
					msg = JSON.parse(String(row.data ?? '{}'));
				} catch {
					continue;
				}

				const event = parseOpenCodeEvent(msg, row.session_id, row.time_created);
				if (event) events.push(event);
			}

			return events;
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

export async function loadOpenCodeEvents(): Promise<UnifiedTokenEvent[]> {
	const basePath = getOpenCodePath();
	if (!basePath) return [];

	const dbPath = path.join(basePath, 'opencode.db');
	const dbEvents = await loadOpenCodeEventsFromDb(dbPath);
	if (dbEvents) return dbEvents;

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

		const event = parseOpenCodeEvent(msg);
		if (event) events.push(event);
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
