import type {
	UnifiedTokenEvent,
	DailyAggregation,
	MonthlyAggregation,
	SourceAggregation,
	ModelAggregation,
	HeatmapCell,
	DashboardData,
	Source,
} from './types.js';
import { emptyTokens, addTokens, totalTokenCount } from './types.js';

function dateKey(timestamp: string): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function monthKey(timestamp: string): string {
	return new Date(timestamp).toISOString().slice(0, 7);
}

function unique<T>(arr: T[]): T[] {
	return [...new Set(arr)];
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
		agg.sources = unique(agg.sources) as Source[];
	}

	return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
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
		agg.sources = unique(agg.sources) as Source[];
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
		agg.sources = unique(agg.sources) as Source[];
	}

	return [...map.values()].sort((a, b) => b.costUSD - a.costUSD);
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
	const monthly = aggregateMonthly(events);
	const bySource = aggregateBySource(events);
	const byModel = aggregateByModel(events);
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
		monthly,
		bySource,
		byModel,
		heatmap,
	};
}
