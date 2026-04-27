use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeUsageResponse {
    pub five_hour: Option<WindowUsage>,
    pub seven_day: Option<WindowUsage>,
    pub extra_usage: Option<ExtraUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowUsage {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    pub is_enabled: bool,
    pub monthly_limit: Option<f64>,
    pub used_credits: Option<f64>,
    pub utilization: Option<f64>,
}

/// Settings POSTed from the frontend. `saved_at` is set server-side on
/// every successful save, so we deliberately don't accept it as input.
#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub session_key: Option<String>,
    pub org_id: Option<String>,
}

/// Settings returned to the frontend. Session key comes from the OS
/// credential store, never the JSON store.
#[derive(Debug, Clone, Serialize)]
pub struct SettingsDisplay {
    pub has_session_key: bool,
    pub session_key: Option<String>,
    pub org_id: Option<String>,
    pub saved_at: Option<u64>,
}

/// Tight projection of TokenBBQ's DashboardData — just what the widget needs.
/// Built by `fetch_local_usage` from the JSON output of `tokenbbq scan`.
/// Token totals exclude `cacheRead` and `cacheCreation` — see
/// `sum_token_counts` in commands.rs for the rationale.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageSummary {
    pub generated: String,
    /// YYYY-MM-DD of the most recent active day. None if the store is empty.
    pub today_date: Option<String>,
    /// Conversational tokens (input + output + reasoning) on `today_date`.
    pub today_tokens: u64,
    /// Same metric summed across the most recent 7 active days.
    pub week_tokens: u64,
    /// Per-source breakdown for `today_date`. Order is whatever `tokenbbq scan`
    /// emits; the UI re-sorts client-side.
    pub today_by_source: Vec<SourceSpend>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpend {
    pub source: String,
    pub tokens: u64,
}
