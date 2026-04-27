export interface WindowUsage {
  utilization: number;
  resets_at: string | null;
}

export interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number | null;
}

export interface ClaudeUsageResponse {
  five_hour: WindowUsage | null;
  seven_day: WindowUsage | null;
  extra_usage: ExtraUsage | null;
}

export interface Settings {
  session_key: string | null;
  org_id: string | null;
  saved_at: number | null;
}

export interface SettingsDisplay {
  has_session_key: boolean;
  session_key: string | null;
  org_id: string | null;
  saved_at: number | null;
}

export type ViewState = "compact" | "expanded" | "settings";

/// Mirrors `api_types::SourceSpend` on the Rust side.
export interface SourceSpend {
  source: string;
  tokens: number;
}

/// Mirrors `api_types::LocalUsageSummary`. todayDate is null when the store
/// is empty; we hide the local zone instead of rendering zeroes.
export interface LocalUsageSummary {
  generated: string;
  todayDate: string | null;
  todayTokens: number;
  weekTokens: number;
  todayBySource: SourceSpend[];
}
