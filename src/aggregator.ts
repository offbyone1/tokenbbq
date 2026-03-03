import type {
	UnifiedTokenEvent,
	DailyAggregation,
	DailySourceAggregation,
	DailyModelAggregation,
	DailySourceModelAggregation,
	MonthlyAggregation,
	SourceAggregation,
	ModelAggregation,
	SourceModelAggregation,
	ProjectAggregation,
	HeatmapCell,
	DashboardData,
	Source,
} from './types.js';
import { emptyTokens, addTokens, totalTokenCount } from './types.js';

const SOURCE_ORDER: Source[] = [
	'claude-code',
	'codex',
	'gemini',
	'antigravity',
	'opencode',
	'amp',
	'pi',
];

function dateKey(timestamp: string): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function monthKey(timestamp: string): string {
	return new Date(timestamp).toISOString().slice(0, 7);
}

function unique<T>(arr: T[]): T[] {
	return [...new Set(arr)];
}

function sourceRank(source: Source): number {
	const index = SOURCE_ORDER.indexOf(source);
	return index === -1 ? SOURCE_ORDER.length : index;
}

function sortSources(sources: Source[]): Source[] {
	return [...sources].sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b));
}

function normalizedProjectName(project?: string): string | null {
	if (typeof project !== 'string') return null;
	const trimmed = project.trim();
	if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;
	return trimmed;
}

export function aggregateDaily(events: UnifiedTokenEvent[]): DailyAggregation[] {
	const map = new Map<string, DailyAggregation>();

	for (const e of events) {
		const key = dateKey(e.timestamp);
		let agg = map.get(key);
		if (!agg) {
			agg = {
				date: key,
				tokens: emptyTokens(),
				costUSD: 0,
				models: [],
				sources: [],
				eventCount: 0,
			};
			map.set(key, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.models.push(e.model);
		agg.sources.push(e.source);
		agg.eventCount++;
	}

	for (const agg of map.values()) {
		agg.models = unique(agg.models);
		agg.sources = sortSources(unique(agg.sources) as Source[]);
	}

	return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateDailyBySource(events: UnifiedTokenEvent[]): DailySourceAggregation[] {
	const map = new Map<string, DailySourceAggregation>();

	for (const e of events) {
		const date = dateKey(e.timestamp);
		const key = `${date}:${e.source}`;
		let agg = map.get(key);
		if (!agg) {
			agg = {
				date,
				source: e.source,
				tokens: emptyTokens(),
				costUSD: 0,
				eventCount: 0,
			};
			map.set(key, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.eventCount++;
	}

	return [...map.values()].sort((a, b) => {
		if (a.date === b.date) return sourceRank(a.source) - sourceRank(b.source);
		return a.date.localeCompare(b.date);
	});
}

export function aggregateDailyByModel(events: UnifiedTokenEvent[]): DailyModelAggregation[] {
	const map = new Map<string, DailyModelAggregation>();

	for (const e of events) {
		const date = dateKey(e.timestamp);
		const key = `${date}:${e.model}`;
		let agg = map.get(key);
		if (!agg) {
			agg = {
				date,
				model: e.model,
				tokens: emptyTokens(),
				costUSD: 0,
				sources: [],
				eventCount: 0,
			};
			map.set(key, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.sources.push(e.source);
		agg.eventCount++;
	}

	for (const agg of map.values()) {
		agg.sources = sortSources(unique(agg.sources) as Source[]);
	}

	return [...map.values()].sort((a, b) => {
		if (a.date === b.date) return a.model.localeCompare(b.model);
		return a.date.localeCompare(b.date);
	});
}

export function aggregateDailyBySourceModel(events: UnifiedTokenEvent[]): DailySourceModelAggregation[] {
	const map = new Map<string, DailySourceModelAggregation>();

	for (const e of events) {
		const date = dateKey(e.timestamp);
		const key = `${date}:${e.source}:${e.model}`;
		let agg = map.get(key);
		if (!agg) {
			agg = {
				date,
				source: e.source,
				model: e.model,
				tokens: emptyTokens(),
				costUSD: 0,
				eventCount: 0,
			};
			map.set(key, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.eventCount++;
	}

	return [...map.values()].sort((a, b) => {
		if (a.date !== b.date) return a.date.localeCompare(b.date);
		if (a.source !== b.source) return sourceRank(a.source) - sourceRank(b.source);
		return a.model.localeCompare(b.model);
	});
}

export function aggregateMonthly(events: UnifiedTokenEvent[]): MonthlyAggregation[] {
	const map = new Map<string, MonthlyAggregation>();

	for (const e of events) {
		const key = monthKey(e.timestamp);
		let agg = map.get(key);
		if (!agg) {
			agg = {
				month: key,
				tokens: emptyTokens(),
				costUSD: 0,
				models: [],
				sources: [],
				eventCount: 0,
			};
			map.set(key, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.models.push(e.model);
		agg.sources.push(e.source);
		agg.eventCount++;
	}

	for (const agg of map.values()) {
		agg.models = unique(agg.models);
		agg.sources = sortSources(unique(agg.sources) as Source[]);
	}

	return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function aggregateBySource(events: UnifiedTokenEvent[]): SourceAggregation[] {
	const map = new Map<Source, SourceAggregation>();

	for (const e of events) {
		let agg = map.get(e.source);
		if (!agg) {
			agg = {
				source: e.source,
				tokens: emptyTokens(),
				costUSD: 0,
				models: [],
				eventCount: 0,
			};
			map.set(e.source, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.models.push(e.model);
		agg.eventCount++;
	}

	for (const agg of map.values()) {
		agg.models = unique(agg.models);
	}

	return [...map.values()].sort((a, b) => {
		if (a.costUSD !== b.costUSD) return b.costUSD - a.costUSD;
		const tokenDiff = totalTokenCount(b.tokens) - totalTokenCount(a.tokens);
		if (tokenDiff !== 0) return tokenDiff;
		if (a.eventCount !== b.eventCount) return b.eventCount - a.eventCount;
		return sourceRank(a.source) - sourceRank(b.source);
	});
}

export function aggregateByProject(events: UnifiedTokenEvent[]): ProjectAggregation[] {
	const map = new Map<string, ProjectAggregation>();

	for (const e of events) {
		const project = normalizedProjectName(e.project);
		if (!project) continue;

		let agg = map.get(project);
		if (!agg) {
			agg = {
				project,
				tokens: emptyTokens(),
				costUSD: 0,
				sources: [],
				eventCount: 0,
			};
			map.set(project, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.sources.push(e.source);
		agg.eventCount++;
	}

	for (const agg of map.values()) {
		agg.sources = sortSources(unique(agg.sources) as Source[]);
	}

	return [...map.values()].sort((a, b) => b.costUSD - a.costUSD);
}

export function aggregateByModel(events: UnifiedTokenEvent[]): ModelAggregation[] {
	const map = new Map<string, ModelAggregation>();

	for (const e of events) {
		let agg = map.get(e.model);
		if (!agg) {
			agg = {
				model: e.model,
				tokens: emptyTokens(),
				costUSD: 0,
				sources: [],
				eventCount: 0,
			};
			map.set(e.model, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.sources.push(e.source);
		agg.eventCount++;
	}

	for (const agg of map.values()) {
		agg.sources = sortSources(unique(agg.sources) as Source[]);
	}

	return [...map.values()].sort((a, b) => b.costUSD - a.costUSD);
}

export function aggregateBySourceModel(events: UnifiedTokenEvent[]): SourceModelAggregation[] {
	const map = new Map<string, SourceModelAggregation>();

	for (const e of events) {
		const key = `${e.source}:${e.model}`;
		let agg = map.get(key);
		if (!agg) {
			agg = {
				source: e.source,
				model: e.model,
				tokens: emptyTokens(),
				costUSD: 0,
				eventCount: 0,
			};
			map.set(key, agg);
		}
		agg.tokens = addTokens(agg.tokens, e.tokens);
		agg.costUSD += e.costUSD;
		agg.eventCount++;
	}

	return [...map.values()].sort((a, b) => {
		if (a.costUSD !== b.costUSD) return b.costUSD - a.costUSD;
		if (a.source !== b.source) return sourceRank(a.source) - sourceRank(b.source);
		return a.model.localeCompare(b.model);
	});
}

export function aggregateHeatmap(events: UnifiedTokenEvent[]): HeatmapCell[] {
	const map = new Map<string, HeatmapCell>();

	for (const e of events) {
		const key = dateKey(e.timestamp);
		let cell = map.get(key);
		if (!cell) {
			cell = { date: key, totalTokens: 0, costUSD: 0 };
			map.set(key, cell);
		}
		cell.totalTokens += totalTokenCount(e.tokens);
		cell.costUSD += e.costUSD;
	}

	return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildDashboardData(events: UnifiedTokenEvent[]): DashboardData {
	const daily = aggregateDaily(events);
	const dailyBySource = aggregateDailyBySource(events);
	const dailyByModel = aggregateDailyByModel(events);
	const dailyBySourceModel = aggregateDailyBySourceModel(events);
	const monthly = aggregateMonthly(events);
	const bySource = aggregateBySource(events);
	const byModel = aggregateByModel(events);
	const bySourceModel = aggregateBySourceModel(events);
	const byProject = aggregateByProject(events);
	const heatmap = aggregateHeatmap(events);

	const totals = events.reduce(
		(acc, e) => {
			acc.tokens = addTokens(acc.tokens, e.tokens);
			acc.costUSD += e.costUSD;
			acc.eventCount++;
			return acc;
		},
		{ tokens: emptyTokens(), costUSD: 0, eventCount: 0 },
	);

	const topModel = byModel[0]?.model ?? 'N/A';
	const topSource = bySource[0]?.source ?? null;

	return {
		generated: new Date().toISOString(),
		totals: {
			...totals,
			totalTokens: totalTokenCount(totals.tokens),
			activeDays: daily.length,
			topModel,
			topSource,
		},
		daily,
		dailyBySource,
		dailyByModel,
		dailyBySourceModel,
		monthly,
		bySource,
		byModel,
		bySourceModel,
		byProject,
		heatmap,
	};
}
