export type Source =
	| 'claude-code'
	| 'codex'
	| 'gemini'
	| 'opencode'
	| 'amp'
	| 'pi';

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

export interface ProjectSourceBreakdown {
	source: Source;
	tokens: TokenCounts;
	costUSD: number;
	eventCount: number;
}

export interface ProjectAggregation {
	project: string;
	projectPath: string;
	tokens: TokenCounts;
	costUSD: number;
	sources: Source[];
	eventCount: number;
	lastActive: string;  // YYYY-MM-DD of latest event
	perSource: ProjectSourceBreakdown[];
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
	gemini: 'Gemini',
	opencode: 'OpenCode',
	amp: 'Amp',
	pi: 'Pi-Agent',
};

export const SOURCE_COLORS: Record<Source, string> = {
	'claude-code': '#c15f3c',
	codex: '#74aa9c',
	gemini: '#1A73E8',
	opencode: '#6366F1',
	amp: '#F59E0B',
	pi: '#8B5CF6',
};

/**
 * Snapshot of Codex CLI rate-limit state read from the most recent
 * session JSONL. Codex emits this structure on every `token_count`
 * event; we keep only the latest one. Unix-seconds reset times are
 * converted to ISO strings at extraction time so consumers can use the
 * same Date(...) parsing as Claude's WindowUsage.
 */
export interface CodexWindowUsage {
	/** 0-100, matches Claude's WindowUsage.utilization semantics. */
	utilization: number;
	/** Window length in minutes (300 for 5h, 10080 for 7d). */
	windowMinutes: number;
	/** ISO 8601 timestamp; null only if Codex emitted a malformed entry. */
	resetsAt: string | null;
}

export interface CodexRateLimits {
	/**
	 * "plus" / "pro" / "team" / "enterprise" / "edu". Null when the
	 * user authenticates via OPENAI_API_KEY (pay-as-you-go has no plan
	 * limits — UI should treat null as "Codex toggle unavailable").
	 */
	planType: string | null;
	/** 5-hour rolling window. Null only if missing in the source event. */
	primary: CodexWindowUsage | null;
	/** 7-day rolling window. Null only if missing in the source event. */
	secondary: CodexWindowUsage | null;
	/**
	 * ISO timestamp of the source `token_count` event — i.e. the
	 * moment of the user's last Codex API call. The widget renders
	 * these numbers without an "as of" stamp by user request, but we
	 * expose this for future use / debugging.
	 */
	snapshotAt: string;
}
