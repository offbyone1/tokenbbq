import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';

const HOME = homedir();
const FALLBACK_MODEL = 'gpt-5';

function getCodexDir(): string | null {
	const envPath = (process.env.CODEX_HOME ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(path.join(resolved, 'sessions'))) return resolved;
	}
	const defaultPath = path.join(HOME, '.codex');
	if (existsSync(path.join(defaultPath, 'sessions'))) return defaultPath;
	return null;
}

function ensureNum(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

type RawUsage = {
	input: number;
	cached: number;
	output: number;
	reasoning: number;
	total: number;
};

function normalizeUsage(val: unknown): RawUsage | null {
	if (!val || typeof val !== 'object') return null;
	const r = val as Record<string, unknown>;
	const input = ensureNum(r.input_tokens);
	const cached = ensureNum(r.cached_input_tokens ?? r.cache_read_input_tokens);
	const output = ensureNum(r.output_tokens);
	const reasoning = ensureNum(r.reasoning_output_tokens);
	const total = ensureNum(r.total_tokens);
	return { input, cached, output, reasoning, total: total > 0 ? total : input + output };
}

function subtractUsage(cur: RawUsage, prev: RawUsage | null): RawUsage {
	return {
		input: Math.max(cur.input - (prev?.input ?? 0), 0),
		cached: Math.max(cur.cached - (prev?.cached ?? 0), 0),
		output: Math.max(cur.output - (prev?.output ?? 0), 0),
		reasoning: Math.max(cur.reasoning - (prev?.reasoning ?? 0), 0),
		total: Math.max(cur.total - (prev?.total ?? 0), 0),
	};
}

function extractModel(payload: Record<string, unknown>): string | undefined {
	const info = payload.info as Record<string, unknown> | undefined;
	if (info) {
		if (typeof info.model === 'string' && info.model) return info.model;
		if (typeof info.model_name === 'string' && info.model_name) return info.model_name;
		const meta = info.metadata as Record<string, unknown> | undefined;
		if (meta && typeof meta.model === 'string' && meta.model) return meta.model;
	}
	if (typeof payload.model === 'string' && payload.model) return payload.model;
	const meta2 = payload.metadata as Record<string, unknown> | undefined;
	if (meta2 && typeof meta2.model === 'string' && meta2.model) return meta2.model;
	return undefined;
}

export async function loadCodexEvents(): Promise<UnifiedTokenEvent[]> {
	const codexDir = getCodexDir();
	if (!codexDir) return [];

	const sessionsDir = path.join(codexDir, 'sessions');
	const files = await glob('**/*.jsonl', { cwd: sessionsDir, absolute: true });
	const events: UnifiedTokenEvent[] = [];

	for (const file of files) {
		const sessionId = path.relative(sessionsDir, file).replace(/\.jsonl$/i, '').replace(/\\/g, '/');
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		let prevTotals: RawUsage | null = null;
		let currentModel: string | undefined;

		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			let entry: Record<string, unknown>;
			try {
				entry = JSON.parse(trimmed);
			} catch {
				continue;
			}

			const entryType = entry.type as string | undefined;
			const payload = (entry.payload ?? {}) as Record<string, unknown>;
			const timestamp = entry.timestamp as string | undefined;

			if (entryType === 'turn_context') {
				const m = extractModel(payload);
				if (m) currentModel = m;
				continue;
			}

			if (entryType !== 'event_msg') continue;
			if ((payload as Record<string, unknown>).type !== 'token_count') continue;
			if (!timestamp) continue;

			const info = payload.info as Record<string, unknown> | undefined;
			const lastUsage = normalizeUsage(info?.last_token_usage);
			const totalUsage = normalizeUsage(info?.total_token_usage);

			let raw = lastUsage;
			if (!raw && totalUsage) {
				raw = subtractUsage(totalUsage, prevTotals);
			}
			if (totalUsage) prevTotals = totalUsage;
			if (!raw) continue;

			if (raw.input === 0 && raw.output === 0) continue;

			const extracted = extractModel({ ...payload, info });
			if (extracted) currentModel = extracted;
			const model = currentModel ?? FALLBACK_MODEL;

			events.push({
				source: 'codex',
				timestamp,
				sessionId,
				model,
				tokens: {
					input: raw.input,
					output: raw.output,
					cacheCreation: 0,
					cacheRead: raw.cached,
					reasoning: raw.reasoning,
				},
				costUSD: 0,
			});
		}
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
