import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStoreDir } from '../store.js';
import type { Source, UnifiedTokenEvent } from '../types.js';

// v2: (a) the Claude loader's dedupeKey is now `string | null` (null for
// entries missing messageId/requestId, never deduped — ccusage parity); v1
// records carry the old synthetic `ts:model:in:out` fallback string. (b) the
// Codex loader now carves reasoning out of `output` (OpenAI reports it as a
// subset); v1 records still hold reasoning-inclusive output. Bumping forces a
// one-time reparse so neither stale shape can leak into fresh runs.
const CACHE_VERSION = 2;

interface FileCacheEntry<T> {
	mtimeMs: number;
	size: number;
	records: T[];
}

interface LoaderCacheFile<T> {
	v: number;
	files: Record<string, FileCacheEntry<T>>;
}

function cacheEnabled(): boolean {
	return process.env.TOKENBBQ_DISABLE_LOADER_CACHE !== '1';
}

function cachePath(source: Source): string {
	return path.join(getStoreDir(), 'cache', 'loaders', `${source}.json`);
}

function isValidEvent(v: unknown): v is UnifiedTokenEvent {
	if (!v || typeof v !== 'object') return false;
	const e = v as Record<string, unknown>;
	const tokens = e.tokens as Record<string, unknown> | undefined;
	return (
		typeof e.source === 'string' &&
		typeof e.timestamp === 'string' &&
		typeof e.sessionId === 'string' &&
		typeof e.model === 'string' &&
		!!tokens &&
		typeof tokens === 'object'
	);
}

function isValidEntry<T>(v: unknown, isValidRecord: (v: unknown) => v is T): v is FileCacheEntry<T> {
	if (!v || typeof v !== 'object') return false;
	const e = v as Record<string, unknown>;
	return (
		typeof e.mtimeMs === 'number' &&
		typeof e.size === 'number' &&
		Array.isArray(e.records) &&
		e.records.every(isValidRecord)
	);
}

async function readCache<T>(
	source: Source,
	isValidRecord: (v: unknown) => v is T,
): Promise<LoaderCacheFile<T>> {
	try {
		const parsed = JSON.parse(await readFile(cachePath(source), 'utf-8')) as unknown;
		if (!parsed || typeof parsed !== 'object') return { v: CACHE_VERSION, files: {} };
		const obj = parsed as Record<string, unknown>;
		if (obj.v !== CACHE_VERSION || !obj.files || typeof obj.files !== 'object') {
			return { v: CACHE_VERSION, files: {} };
		}
		const files: Record<string, FileCacheEntry<T>> = {};
		for (const [file, entry] of Object.entries(obj.files as Record<string, unknown>)) {
			if (isValidEntry(entry, isValidRecord)) files[file] = entry;
		}
		return { v: CACHE_VERSION, files };
	} catch {
		return { v: CACHE_VERSION, files: {} };
	}
}

async function writeCache<T>(source: Source, cache: LoaderCacheFile<T>): Promise<void> {
	const file = cachePath(source);
	const dir = path.dirname(file);
	const tmp = path.join(dir, `${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(tmp, JSON.stringify(cache), 'utf-8');
		await rename(tmp, file);
	} catch {
		// Loader caches are performance-only. A failed write must never make scans fail.
	}
}

export async function loadCachedFileRecords<T>(
	source: Source,
	files: string[],
	parseFile: (file: string) => Promise<T[]>,
	isValidRecord: (v: unknown) => v is T,
): Promise<T[]> {
	if (!cacheEnabled()) {
		const records: T[] = [];
		for (const file of files) records.push(...await parseFile(file));
		return records;
	}

	const cache = await readCache(source, isValidRecord);
	const nextFiles: Record<string, FileCacheEntry<T>> = {};
	const records: T[] = [];

	for (const file of files) {
		let info: { mtimeMs: number; size: number };
		try {
			const s = await stat(file);
			info = { mtimeMs: s.mtimeMs, size: s.size };
		} catch {
			continue;
		}

		const hit = cache.files[file];
		if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
			nextFiles[file] = hit;
			records.push(...hit.records);
			continue;
		}

		const parsed = await parseFile(file);
		const entry = { ...info, records: parsed };
		nextFiles[file] = entry;
		records.push(...parsed);
	}

	await writeCache(source, { v: CACHE_VERSION, files: nextFiles });
	return records;
}

export async function loadCachedFileEvents(
	source: Source,
	files: string[],
	parseFile: (file: string) => Promise<UnifiedTokenEvent[]>,
): Promise<UnifiedTokenEvent[]> {
	return loadCachedFileRecords(source, files, parseFile, isValidEvent);
}
