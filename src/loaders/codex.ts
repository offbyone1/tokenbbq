import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent, CodexRateLimits, CodexWindowUsage } from '../types.js';
import { resolveProjectRoot } from '../project.js';

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

export function getCodexWatchPaths(): string[] {
	const dir = getCodexDir();
	return dir ? [path.join(dir, 'sessions')] : [];
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
		let sessionProject: string | undefined;

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

			if (entryType === 'session_meta') {
				const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined;
				if (cwd) sessionProject = resolveProjectRoot(cwd).name;
				continue;
			}

			if (entryType === 'turn_context') {
				const m = extractModel(payload);
				if (m) currentModel = m;
				continue;
			}

			if (entryType !== 'event_msg') continue;
			if ((payload as Record<string, unknown>).type !== 'token_count') continue;
			if (!timestamp) continue;

			const info = payload.info as Record<string, unknown> | undefined;
			const totalUsage = normalizeUsage(info?.total_token_usage);
			const lastUsage = normalizeUsage(info?.last_token_usage);

			if (!totalUsage) continue;

			let raw: RawUsage;
			if (prevTotals === null) {
				raw = lastUsage ?? totalUsage;
			} else {
				raw = subtractUsage(totalUsage, prevTotals);
			}
			prevTotals = totalUsage;
			if (raw.input === 0 && raw.output === 0 && raw.cached === 0) continue;

			if (raw.input === 0 && raw.output === 0) continue;

			const extracted = extractModel({ ...payload, info });
			if (extracted) currentModel = extracted;
			const model = currentModel ?? FALLBACK_MODEL;

			// OpenAI reports `input_tokens` as the TOTAL prompt size including
			// the cached portion; `cached_input_tokens` is the subset served from
			// cache. Storing both verbatim double-counts cache reads inside
			// `input`. Split them so `tokens.input` is fresh-input only — matches
			// the semantics of every other loader (Claude Code, Gemini, etc.).
			const freshInput = Math.max(raw.input - raw.cached, 0);
			events.push({
				source: 'codex',
				timestamp,
				sessionId,
				model,
				tokens: {
					input: freshInput,
					output: raw.output,
					cacheCreation: 0,
					cacheRead: raw.cached,
					reasoning: raw.reasoning,
				},
				costUSD: 0,
				project: sessionProject,
			});
		}
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}

function parseRateLimitWindow(raw: unknown): CodexWindowUsage | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const used = typeof r.used_percent === 'number' ? r.used_percent : null;
	const windowMin = typeof r.window_minutes === 'number' ? r.window_minutes : null;
	const resetsUnix = typeof r.resets_at === 'number' ? r.resets_at : null;
	if (used === null || windowMin === null) return null;
	return {
		utilization: used,
		windowMinutes: windowMin,
		resetsAt: resetsUnix !== null ? new Date(resetsUnix * 1000).toISOString() : null,
	};
}

/// Read the most recent rate_limits snapshot Codex has written to its
/// session JSONL files. Returns null when:
///   - no Codex installation is detected
///   - no session contains a rate_limits-bearing event
/// Sessions are scanned newest-first (by mtime); the LAST rate_limits
/// entry within the newest session that contains one wins.
export async function loadCodexRateLimits(): Promise<CodexRateLimits | null> {
	const codexDir = getCodexDir();
	if (!codexDir) return null;

	const sessionsDir = path.join(codexDir, 'sessions');
	const files = await glob('**/*.jsonl', { cwd: sessionsDir, absolute: true });
	if (files.length === 0) return null;

	const { stat } = await import('node:fs/promises');
	const withMtime = await Promise.all(files.map(async (file) => {
		const s = await stat(file);
		return { path: file, mtimeMs: s.mtimeMs };
	}));

	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

	for (const { path: file } of withMtime) {
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		let lastSnapshot: CodexRateLimits | null = null;
		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			let entry: Record<string, unknown>;
			try {
				entry = JSON.parse(trimmed);
			} catch {
				continue;
			}

			if (entry.type !== 'event_msg') continue;
			const payload = entry.payload as Record<string, unknown> | undefined;
			if (!payload || payload.type !== 'token_count') continue;
			const rl = payload.rate_limits as Record<string, unknown> | undefined;
			if (!rl) continue;
			const ts = typeof entry.timestamp === 'string' ? entry.timestamp : null;
			if (!ts) continue;

			lastSnapshot = {
				planType: typeof rl.plan_type === 'string' ? rl.plan_type : null,
				primary: parseRateLimitWindow(rl.primary),
				secondary: parseRateLimitWindow(rl.secondary),
				snapshotAt: ts,
			};
		}

		if (lastSnapshot) return lastSnapshot;
	}

	return null;
}
