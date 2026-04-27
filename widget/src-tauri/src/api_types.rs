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
    pub monthly_limit: f64,
    pub used_credits: f64,
    pub utilization: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub session_key: Option<String>,
    pub org_id: Option<String>,
    pub saved_at: Option<u64>,
}

/// Settings returned to the frontend. Session key is stored securely in the OS credential store.
#[derive(Debug, Clone, Serialize)]
pub struct SettingsDisplay {
    pub has_session_key: bool,
    pub session_key: Option<String>,
    pub org_id: Option<String>,
    pub saved_at: Option<u64>,
}

/// Tight projection of TokenBBQ's DashboardData — just what the widget needs.
/// Built by `fetch_local_usage` from the JSON output of `tokenbbq scan`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageSummary {
    pub generated: String,
    /// YYYY-MM-DD of the most recent active day. None if the store is empty.
    pub today_date: Option<String>,
    /// Total tokens (input + output + cache + reasoning) on the most recent active day.
    pub today_tokens: u64,
    /// Total tokens across the last up-to-7 active days (inclusive of today).
    pub week_tokens: u64,
    /// Per-source breakdown for `today_date`, sorted by tokens desc upstream-agnostic.
    pub today_by_source: Vec<SourceSpend>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpend {
    pub source: String,
    pub tokens: u64,
}
