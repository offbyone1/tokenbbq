import pc from 'picocolors';
import type { Source, UnifiedTokenEvent } from '../types.js';
import { SOURCE_LABELS } from '../types.js';
import { loadClaudeEvents, getClaudeWatchPaths } from './claude.js';
import { loadCodexEvents, getCodexWatchPaths } from './codex.js';
import { loadGeminiEvents, getGeminiWatchPaths } from './gemini.js';
import { loadOpenCodeEvents, getOpenCodeWatchPaths } from './opencode.js';
import { loadAmpEvents, getAmpWatchPaths } from './amp.js';
import { loadPiEvents, getPiWatchPaths } from './pi.js';

export function getAllWatchPaths(): string[] {
	return [
		...getClaudeWatchPaths(),
		...getCodexWatchPaths(),
		...getGeminiWatchPaths(),
		...getOpenCodeWatchPaths(),
		...getAmpWatchPaths(),
		...getPiWatchPaths(),
	];
}

export interface LoaderOptions {
	quiet: boolean;
}

type LoaderEntry = {
	source: Source;
	load: (opts: LoaderOptions) => Promise<UnifiedTokenEvent[]>;
};

const LOADERS: LoaderEntry[] = [
	{ source: 'claude-code', load: loadClaudeEvents },
	{ source: 'codex', load: loadCodexEvents },
	{ source: 'gemini', load: loadGeminiEvents },
	{ source: 'opencode', load: loadOpenCodeEvents },
	{ source: 'amp', load: loadAmpEvents },
	{ source: 'pi', load: loadPiEvents },
];

export type LoadAllResult = {
	events: UnifiedTokenEvent[];
	detected: Source[];
	errors: Array<{ source: Source; error: string }>;
};

export async function loadAll(quiet = false): Promise<LoadAllResult> {
	const events: UnifiedTokenEvent[] = [];
	const detected: Source[] = [];
	const errors: Array<{ source: Source; error: string }> = [];
	const log = quiet ? () => {} : console.error.bind(console);

	const results = await Promise.allSettled(
		LOADERS.map(async (loader) => {
			const loaderEvents = await loader.load({ quiet });
			return { source: loader.source, events: loaderEvents };
		}),
	);

	for (const result of results) {
		if (result.status === 'fulfilled') {
			const { source, events: loaderEvents } = result.value;
			if (loaderEvents.length > 0) {
				detected.push(source);
				events.push(...loaderEvents);
				log(
					pc.green('  ✓'),
					pc.bold(SOURCE_LABELS[source]),
					pc.dim(`(${loaderEvents.length.toLocaleString()} events)`),
				);
			}
		} else {
			const loaderSource = LOADERS[results.indexOf(result)]!.source;
			errors.push({ source: loaderSource, error: String(result.reason) });
		}
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return { events, detected, errors };
}
