export type Source = 'claude-code' | 'codex' | 'opencode' | 'amp' | 'pi';

export interface TokenCounts {
	input: number;
	output: number;
	cacheCreation: number;
	cacheRead: number;
	reasoning: number;
}

export interface UnifiedTokenEvent {
	source: Source;
	timestamp: string;
	sessionId: string;
	model: string;
	tokens: TokenCounts;
	costUSD: number;
	project?: string;
}

export interface DailyAggregation {
	date: string;
	tokens: TokenCounts;
	costUSD: number;
	models: string[];
	sources: Source[];
	eventCount: number;
}

export interface DailySourceAggregation {
	date: string;
	source: Source;
	tokens: TokenCounts;
	costUSD: number;
	eventCount: number;
}

export interface DailyModelAggregation {
	date: string;
	model: string;
	tokens: TokenCounts;
	costUSD: number;
	sources: Source[];
	eventCount: number;
}

export interface DailySourceModelAggregation {
	date: string;
	source: Source;
	model: string;
	tokens: TokenCounts;
	costUSD: number;
	eventCount: number;
}

export interface MonthlyAggregation {
	month: string;
	tokens: TokenCounts;
	costUSD: number;
	models: string[];
	sources: Source[];
	eventCount: number;
}

export interface SourceAggregation {
	source: Source;
	tokens: TokenCounts;
	costUSD: number;
	models: string[];
	eventCount: number;
}

export interface ModelAggregation {
	model: string;
	tokens: TokenCounts;
	costUSD: number;
	sources: Source[];
	eventCount: number;
}

export interface SourceModelAggregation {
	source: Source;
	model: string;
	tokens: TokenCounts;
	costUSD: number;
	eventCount: number;
}

export interface ProjectAggregation {
	project: string;
	tokens: TokenCounts;
	costUSD: number;
	sources: Source[];
	eventCount: number;
}

export interface HeatmapCell {
	date: string;
	totalTokens: number;
	costUSD: number;
}

export interface DashboardData {
	generated: string;
	totals: {
		tokens: TokenCounts;
		costUSD: number;
		totalTokens: number;
		eventCount: number;
		activeDays: number;
		topModel: string;
		topSource: Source | null;
	};
	daily: DailyAggregation[];
	dailyBySource: DailySourceAggregation[];
	dailyByModel: DailyModelAggregation[];
	dailyBySourceModel: DailySourceModelAggregation[];
	monthly: MonthlyAggregation[];
	bySource: SourceAggregation[];
	byModel: ModelAggregation[];
	bySourceModel: SourceModelAggregation[];
	byProject: ProjectAggregation[];
	heatmap: HeatmapCell[];
}

export function emptyTokens(): TokenCounts {
	return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 };
}

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheCreation: a.cacheCreation + b.cacheCreation,
		cacheRead: a.cacheRead + b.cacheRead,
		reasoning: a.reasoning + b.reasoning,
	};
}

export function totalTokenCount(t: TokenCounts): number {
	return t.input + t.output + t.cacheCreation + t.cacheRead + t.reasoning;
}

export const SOURCE_LABELS: Record<Source, string> = {
	'claude-code': 'Claude Code',
	codex: 'Codex',
	opencode: 'OpenCode',
	amp: 'Amp',
	pi: 'Pi-Agent',
};

export const SOURCE_COLORS: Record<Source, string> = {
	'claude-code': '#c15f3c',
	codex: '#74aa9c',
	opencode: '#6366F1',
	amp: '#F59E0B',
	pi: '#8B5CF6',
};
