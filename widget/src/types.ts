export interface WindowUsage {
  utilization: number;
  resets_at: string | null;
}

export interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
}

export interface ClaudeUsageResponse {
  five_hour: WindowUsage | null;
  seven_day: WindowUsage | null;
  extra_usage: ExtraUsage | null;
}

/** Settings input shape for save_settings. saved_at is set server-side. */
export interface Settings {
  session_key: string | null;
  org_id: string | null;
}

export interface SettingsDisplay {
  has_session_key: boolean;
  session_key: string | null;
  org_id: string | null;
  saved_at: number | null;
}

export type ViewState = "compact" | "expanded" | "settings";

export interface CodexWindowUsage {
  utilization: number;
  windowMinutes: number;
  resetsAt: string | null;
}

export interface CodexUsage {
  planType: string | null;
  primary: CodexWindowUsage | null;
  secondary: CodexWindowUsage | null;
  snapshotAt: string;
}

/// Mirrors `api_types::SourceSpend` on the Rust side.
export interface SourceSpend {
  source: string;
  tokens: number;
}

/// Mirrors `api_types::LocalUsageSummary`. todayDate is null when the store
/// is empty. The widget hides the local zone when the entire summary fails
/// to load, but renders the section header even when todayBySource is [].
export interface LocalUsageSummary {
  generated: string;
  todayDate: string | null;
  todayTokens: number;
  weekTokens: number;
  todayBySource: SourceSpend[];
  codexUsage: CodexUsage | null;
}
