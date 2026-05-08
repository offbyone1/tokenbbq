import type { Source, UnifiedTokenEvent } from './types.js';

export function mergeFreshSourceEvents(
	stored: UnifiedTokenEvent[],
	scanned: UnifiedTokenEvent[],
	freshSources: Source[],
): UnifiedTokenEvent[] {
	const fresh = new Set<Source>(freshSources);
	return [
		...stored.filter((event) => !fresh.has(event.source)),
		...scanned.filter((event) => fresh.has(event.source)),
	];
}
