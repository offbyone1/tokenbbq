import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';
import { isValidTimestamp } from '../types.js';
import { resolveProjectRoot } from '../project.js';
import { loadCachedFileRecords } from './cache.js';

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

// valibot `v.number()` (required): present and a real number, else the entry
// is rejected. Returns null to signal "reject the whole event".
function requiredTokenNumber(x: unknown): number | null {
	return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

// valibot `v.optional(v.number())`: only an ABSENT key (JS `undefined`) is
// allowed to be missing → default 0. A PRESENT value must be a real number;
// `null` (JSON null), strings, etc. are not numbers, so valibot fails the
// parse and ccusage drops the whole entry. Returning null signals "reject".
function optionalTokenNumber(x: unknown): number | null {
	if (x === undefined) return 0;
	return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function parseLine(raw: Record<string, unknown>): UnifiedTokenEvent | null {
	if (!isValidTimestamp(raw.timestamp)) return null;

	const message = raw.message as Record<string, unknown> | undefined;
	if (!message) return null;

	const usage = message.usage as Record<string, unknown> | undefined;
	if (!usage) return null;

	const model = String(message.model ?? 'unknown');

	// Mirror ccusage's usageDataSchema (apps/ccusage/src/data-loader.ts:167):
	// message.usage.input_tokens / output_tokens are required `v.number()`,
	// the two cache fields are `v.optional(v.number())`. A required field that
	// is absent or not a number makes ccusage drop the whole entry; an optional
	// field absent defaults to 0 but, if present, must be a number. We coerce
	// nothing (string "100" is rejected, just like valibot) and additionally
	// reject non-finite numbers (Infinity from `1e999`) — intentional hardening
	// over bare v.number(); such values can't occur in well-formed JSONL.
	const input = requiredTokenNumber(usage.input_tokens);
	if (input === null) return null;
	const output = requiredTokenNumber(usage.output_tokens);
	if (output === null) return null;
	const cacheCreation = optionalTokenNumber(usage.cache_creation_input_tokens);
	if (cacheCreation === null) return null;
	const cacheRead = optionalTokenNumber(usage.cache_read_input_tokens);
	if (cacheRead === null) return null;

	// No zero-token drop: ccusage's schema accepts input_tokens/output_tokens
	// of 0 and still sums cache_creation/cache_read (calculateTotals). A cache-
	// only turn (input=0, output=0, cache_read>0) is real usage; dropping it
	// here undercounted tokens and cost versus ccusage.

	return {
		source: 'claude-code',
		timestamp: raw.timestamp,
		sessionId: String(raw.sessionId ?? 'unknown'),
		model,
		tokens: {
			input,
			output,
			cacheCreation,
			cacheRead,
			reasoning: 0,
		},
		costUSD: typeof raw.costUSD === 'number' ? raw.costUSD : 0,
	};
}

// dedupeKey is null when the upstream entry lacks a messageId or requestId.
// ccusage's createUniqueHash returns null in that case and isDuplicateEntry
// (null) === false — i.e. ID-less entries are NEVER treated as duplicates.
type CachedClaudeEvent = {
	dedupeKey: string | null;
	event: UnifiedTokenEvent;
};

function isCachedClaudeEvent(value: unknown): value is CachedClaudeEvent {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	const event = record.event as Record<string, unknown> | undefined;
	return (
		(typeof record.dedupeKey === 'string' || record.dedupeKey === null) &&
		!!event &&
		typeof event.source === 'string' &&
		typeof event.timestamp === 'string' &&
		typeof event.sessionId === 'string' &&
		typeof event.model === 'string' &&
		!!event.tokens &&
		typeof event.tokens === 'object'
	);
}

export function getClaudeWatchPaths(): string[] {
	return getClaudePaths().map((p) => path.join(p, 'projects'));
}

export async function loadClaudeEvents(): Promise<UnifiedTokenEvent[]> {
	const claudePaths = getClaudePaths();
	if (claudePaths.length === 0) return [];

	const allFiles: string[] = [];

	for (const claudePath of claudePaths) {
		const projectsDir = path.join(claudePath, 'projects');
		const files = await glob('**/*.jsonl', { cwd: projectsDir, absolute: true });
		allFiles.push(...files);
	}

	const records = await loadCachedFileRecords('claude-code', allFiles, async (file) => {
		const fileEvents: CachedClaudeEvent[] = [];
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			return fileEvents;
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
			// Match ccusage exactly: a stable key ONLY when both ids exist;
			// otherwise null → never deduplicated. The previous synthetic
			// `timestamp:model:input:output` fallback could collapse genuinely
			// distinct ID-less events (it also ignored cache tokens), making
			// totals lower than ccusage.
			const dedupeKey = requestId && messageId
				? `${messageId}:${requestId}`
				: null;

			fileEvents.push({ dedupeKey, event });
		}
		return fileEvents;
	}, isCachedClaudeEvent);

	const seen = new Set<string>();
	const events = records.flatMap((record) => {
		// null key (missing messageId/requestId) is never a duplicate and is
		// never recorded — mirrors ccusage isDuplicateEntry(null)===false +
		// markAsProcessed(null)=noop. Only id-bearing entries are deduped.
		if (record.dedupeKey === null) return [record.event];
		if (seen.has(record.dedupeKey)) return [];
		seen.add(record.dedupeKey);
		return [record.event];
	});

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return events;
}
