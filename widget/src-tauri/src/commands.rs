use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::api_types::{ClaudeUsageResponse, CodexUsage, ExtraUsage, LocalUsageSummary, Settings, SettingsDisplay, SourceSpend, WindowUsage};

const USER_AGENT: &str = concat!("TokenBBQ-Widget/", env!("CARGO_PKG_VERSION"));

// Suppresses the console window that Windows would otherwise flash whenever
// a GUI process spawns a console-subsystem child. The widget polls the
// TokenBBQ sidecar regularly, so without this flag users see a cmd window
// pop up every refresh.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn is_valid_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

fn is_valid_session_key(s: &str) -> bool {
    !s.is_empty()
        && s.len() < 1024
        && s.bytes().all(|b| b.is_ascii_graphic())
        && !s.contains('\r')
        && !s.contains('\n')
}

const KEYRING_SERVICE: &str = "com.offbyone1.tokenbbq";
const KEYRING_USER: &str = "session_key";

fn keyring_get() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring error: {}", e))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read from credential store: {}", e)),
    }
}

fn keyring_set(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring error: {}", e))?;
    entry
        .set_password(key)
        .map_err(|e| format!("Failed to save to credential store: {}", e))
}

async fn keyring_get_async() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(keyring_get)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

async fn keyring_set_async(key: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || keyring_set(&key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// === OAuth path (primary, since 0.6.x) ===
//
// Reads the OAuth access-token Claude Code stores in ~/.claude/.credentials.json,
// POSTs `max_tokens=0` to api.anthropic.com/v1/messages, and parses the
// `anthropic-ratelimit-unified-*` response headers. This eliminates the manual
// sessionKey-paste flow entirely. Cost per refresh: ~8 input tokens against the
// user's 5h plan window (Pro/Max), throttled to one call per 60s — sub-promille
// drift on the displayed numbers.
//
// Surfaces it relies on:
//   - .credentials.json schema (claudeAiOauth.accessToken) — undocumented
//   - anthropic-ratelimit-unified-* response headers — undocumented
// If either changes, the legacy sessionKey path below can be re-enabled.

const OAUTH_TTL: Duration = Duration::from_secs(60);

struct CachedUsage {
    fetched_at: Instant,
    response: ClaudeUsageResponse,
}

static OAUTH_CACHE: Mutex<Option<CachedUsage>> = Mutex::new(None);

fn credentials_path() -> Option<PathBuf> {
    // Honor CLAUDE_CONFIG_DIR like the TokenBBQ Claude loader does, so users
    // with non-default install layouts still work.
    if let Ok(custom) = std::env::var("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(custom).join(".credentials.json"));
    }
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())?;
    Some(PathBuf::from(home).join(".claude").join(".credentials.json"))
}

#[derive(serde::Deserialize)]
struct CredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<ClaudeAiOauth>,
}

#[derive(serde::Deserialize)]
struct ClaudeAiOauth {
    #[serde(rename = "accessToken")]
    access_token: String,
}

async fn read_oauth_token() -> Result<String, String> {
    let path = credentials_path()
        .ok_or("Could not resolve Claude credentials path (no HOME/USERPROFILE).")?;
    let contents = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| {
            format!(
                "Could not read {}: {}. Run `claude auth login` to create it.",
                path.display(),
                e
            )
        })?;
    let parsed: CredentialsFile = serde_json::from_str(&contents)
        .map_err(|e| format!("Could not parse credentials file: {}", e))?;
    parsed
        .claude_ai_oauth
        .ok_or_else(|| "credentials.json is missing claudeAiOauth section.".to_string())
        .map(|o| o.access_token)
}

fn header_str(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers.get(name)?.to_str().ok().map(String::from)
}

fn parse_utilization_pct(raw: Option<String>) -> f64 {
    raw.and_then(|v| v.parse::<f64>().ok())
        .map(|v| (v * 100.0).clamp(0.0, 100.0))
        .unwrap_or(0.0)
}

fn parse_unix_to_iso(raw: Option<String>) -> Option<String> {
    let secs: i64 = raw?.parse().ok()?;
    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0).map(|dt| dt.to_rfc3339())
}

async fn fetch_via_oauth_headers(
    client: &reqwest::Client,
    token: &str,
) -> Result<ClaudeUsageResponse, String> {
    // Cheapest legal /v1/messages call: max_tokens=0 with a 1-char prompt.
    // Empirically returns 200 with the full anthropic-ratelimit-unified-*
    // header set; validation errors (400/404) and count_tokens do NOT include
    // these headers, so we have to actually make a successful call.
    let body = serde_json::json!({
        "model": "claude-haiku-4-5",
        "max_tokens": 0,
        "messages": [{"role": "user", "content": "x"}]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = resp.status();
    let headers = resp.headers().clone();
    // Drain body without parsing — the rate-limit data lives in headers, the
    // body itself is just the empty assistant response.
    let _ = resp.bytes().await;

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(
            "OAuth token rejected. Run `claude auth login` to refresh credentials.".to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!("Anthropic API error: HTTP {}", status.as_u16()));
    }

    let five_h_util = header_str(&headers, "anthropic-ratelimit-unified-5h-utilization");
    let five_h_reset = header_str(&headers, "anthropic-ratelimit-unified-5h-reset");
    let seven_d_util = header_str(&headers, "anthropic-ratelimit-unified-7d-utilization");
    let seven_d_reset = header_str(&headers, "anthropic-ratelimit-unified-7d-reset");
    let overage_status = header_str(&headers, "anthropic-ratelimit-unified-overage-status");
    let overage_util = header_str(&headers, "anthropic-ratelimit-unified-overage-utilization");

    if five_h_util.is_none() && seven_d_util.is_none() {
        return Err(
            "Anthropic response missing unified rate-limit headers. The undocumented header schema may have changed."
                .to_string(),
        );
    }

    let five_hour = five_h_util.as_ref().map(|_| WindowUsage {
        utilization: parse_utilization_pct(five_h_util.clone()),
        resets_at: parse_unix_to_iso(five_h_reset),
    });
    let seven_day = seven_d_util.as_ref().map(|_| WindowUsage {
        utilization: parse_utilization_pct(seven_d_util.clone()),
        resets_at: parse_unix_to_iso(seven_d_reset),
    });

    // Overage = the existing extra_usage shape. Unified headers don't expose
    // monthly_limit / used_credits / currency, so those stay None and the UI
    // falls back to the unlimited-style display (utilization bar without a
    // "$X / $Y" meta line). is_enabled tracks the overage-status header:
    // "allowed" → enabled, anything else (or absent) → not enabled.
    let extra_usage = overage_status.as_deref().filter(|s| !s.is_empty()).map(|s| ExtraUsage {
        is_enabled: s == "allowed",
        monthly_limit: None,
        used_credits: None,
        utilization: Some(parse_utilization_pct(overage_util)),
        currency: None,
    });

    Ok(ClaudeUsageResponse {
        five_hour,
        seven_day,
        extra_usage,
    })
}

#[tauri::command]
pub async fn fetch_usage(client: State<'_, reqwest::Client>) -> Result<ClaudeUsageResponse, String> {
    // 60s cache — keeps quota consumption sub-promille even if the frontend
    // polls every few seconds. Cache hit path is a single Mutex lock + clone.
    if let Ok(guard) = OAUTH_CACHE.lock() {
        if let Some(c) = guard.as_ref() {
            if c.fetched_at.elapsed() < OAUTH_TTL {
                return Ok(c.response.clone());
            }
        }
    }

    let token = read_oauth_token().await?;
    let response = fetch_via_oauth_headers(&client, &token).await?;

    if let Ok(mut guard) = OAUTH_CACHE.lock() {
        *guard = Some(CachedUsage {
            fetched_at: Instant::now(),
            response: response.clone(),
        });
    }

    Ok(response)
}

// === LEGACY sessionKey path (retained, commented out, as fallback) =========
//
// The pre-0.6 implementation called claude.ai/api/organizations/{org_id}/usage
// using the user's manually-pasted sessionKey cookie + auto-detected org UUID.
// It produced richer ExtraUsage data (monthly_limit, used_credits, currency)
// that the unified-headers path cannot expose, but required a manual paste
// from browser devtools and silently broke whenever Anthropic rotated the
// cookie name or hardened CSRF.
//
// To re-enable (e.g. if Anthropic removes the unified-* headers or moves
// .credentials.json into the OS keystore):
//   1. Uncomment the `claude_get` helper and the body of `fetch_usage_via_session_key` below.
//   2. Replace the body of `fetch_usage` above with:
//          fetch_usage_via_session_key(app, client).await
//      (and re-add `app: AppHandle` to its signature).
//   3. Add `auto_detect_org` back to lib.rs's invoke_handler list if it was removed.
//
// /*
// async fn claude_get(client: &reqwest::Client, url: &str, session_key: &str) -> Result<reqwest::Response, String> {
//     let resp = client
//         .get(url)
//         .header("Cookie", format!("sessionKey={}", session_key))
//         .header("Content-Type", "application/json")
//         .header("User-Agent", USER_AGENT)
//         .send()
//         .await
//         .map_err(|e| format!("Network error: {}", e))?;
//
//     let status = resp.status();
//     if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
//         return Err("Session expired. Update your session key in Settings.".to_string());
//     }
//     if !status.is_success() {
//         return Err(format!("API error: HTTP {}", status.as_u16()));
//     }
//
//     Ok(resp)
// }
//
// async fn fetch_usage_via_session_key(app: AppHandle, client: State<'_, reqwest::Client>) -> Result<ClaudeUsageResponse, String> {
//     let session_key = keyring_get_async()
//         .await?
//         .ok_or("No session key configured.")?;
//
//     let store = app.store("settings.json").map_err(|e| e.to_string())?;
//     let org_id = store
//         .get("org_id")
//         .and_then(|v| v.as_str().map(String::from))
//         .ok_or("No organization ID configured.")?;
//
//     if !is_valid_uuid(&org_id) {
//         return Err("Invalid organization ID format.".to_string());
//     }
//
//     let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);
//
//     claude_get(&client, &url, &session_key)
//         .await?
//         .json::<ClaudeUsageResponse>()
//         .await
//         .map_err(|e| format!("Parse error: {}", e))
// }
// */

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if let Some(ref key) = settings.session_key {
        if !is_valid_session_key(key) {
            return Err("Invalid session key format.".to_string());
        }
        keyring_set_async(key.clone()).await?;
        store.set("saved_at", serde_json::json!(now));
    }
    if let Some(ref oid) = settings.org_id {
        if !is_valid_uuid(oid) {
            return Err("Invalid organization ID format.".to_string());
        }
        store.set("org_id", serde_json::json!(oid));
    }

    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<SettingsDisplay, String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;

    // Read from keyring, with migration from legacy plaintext store
    let mut session_key = keyring_get_async().await?;

    if session_key.is_none() {
        // Migration: check both legacy store key names
        let store_key = store
            .get("session_key")
            .and_then(|v| v.as_str().map(String::from))
            .or_else(|| {
                store
                    .get("claude_session_key")
                    .and_then(|v| v.as_str().map(String::from))
            });

        if let Some(key) = store_key {
            keyring_set_async(key.clone()).await?;
            store.delete("session_key");
            store.delete("claude_session_key");
            store.save().map_err(|e| e.to_string())?;
            session_key = Some(key);
        }
    }

    Ok(SettingsDisplay {
        has_session_key: session_key.is_some(),
        org_id: store.get("org_id").and_then(|v| v.as_str().map(String::from)),
        saved_at: store.get("saved_at").and_then(|v| v.as_u64()),
    })
}

// auto_detect_org is part of the legacy sessionKey path. With the OAuth
// fetch_usage primary, the org-id arrives via `anthropic-organization-id`
// response header on every successful /v1/messages call, so detection is
// implicit and this RPC is no longer needed. Kept commented as fallback.
//
// /*
// #[tauri::command]
// pub async fn auto_detect_org(client: State<'_, reqwest::Client>, session_key: String) -> Result<String, String> {
//     if !is_valid_session_key(&session_key) {
//         return Err("Invalid session key format.".to_string());
//     }
//
//     let resp = claude_get(&client, "https://claude.ai/api/organizations", &session_key).await?;
//
//     let orgs: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
//
//     orgs.first()
//         .and_then(|o| o["uuid"].as_str().map(String::from))
//         .ok_or("No organizations found".to_string())
// }
// */

/// Resolve how to invoke TokenBBQ's `scan` subcommand. Returns the program +
/// argument list ready for std::process::Command. Resolution order:
///   1. TOKENBBQ_SIDECAR_PATH env var (always wins — explicit override).
///   2. Debug-only: `<repo>/dist/index.js` via Node. Preferred over the
///      bundled exe in dev because the latter is whatever was Bun-compiled
///      last (often stale on machines without Bun on PATH), and Bun-compiled
///      Windows binaries have spawn-from-GUI quirks that manifest as silent
///      hangs when the parent process is the Tauri webview host.
///   3. Bundled sidecar next to the widget binary — Tauri's `externalBin`
///      mechanism copies `binaries/tokenbbq-<triple>{.exe}` to the install
///      dir as `tokenbbq{.exe}`. This is the production path; CI rebuilds
///      the Bun binary on every release so freshness is guaranteed there.
///   4. Release fallback: `<repo>/dist/index.js` (same path as step 2 but
///      reached only if the bundled exe is missing).
fn resolve_tokenbbq_invocation() -> Result<(PathBuf, Vec<String>), String> {
    let mut tried: Vec<String> = Vec::new();

    if let Ok(env_path) = std::env::var("TOKENBBQ_SIDECAR_PATH") {
        let p = PathBuf::from(&env_path);
        if p.exists() {
            return Ok(invocation_for(p));
        }
        tried.push(format!("env TOKENBBQ_SIDECAR_PATH={} (missing)", env_path));
    }

    let dev_fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("dist")
        .join("index.js");

    #[cfg(debug_assertions)]
    {
        if dev_fallback.exists() {
            return Ok(invocation_for(dev_fallback.clone()));
        }
        tried.push(format!("dev fallback {} (missing)", dev_fallback.display()));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Tauri's externalBin install layout varies by bundler: NSIS
            // typically strips the triple, but MSI / future versions may
            // keep it, and some bundle modes drop the binary into a
            // resources/ subdir. Try every plausible layout before giving up.
            let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
                vec![
                    dir.join("tokenbbq.exe"),
                    dir.join("resources").join("tokenbbq.exe"),
                    dir.join("binaries").join("tokenbbq.exe"),
                    dir.join("tokenbbq-x86_64-pc-windows-msvc.exe"),
                    dir.join("resources").join("tokenbbq-x86_64-pc-windows-msvc.exe"),
                ]
            } else if cfg!(target_os = "macos") {
                vec![
                    dir.join("tokenbbq"),
                    dir.join("../Resources/tokenbbq"),
                    dir.join("../Resources/_up_/tokenbbq"),
                    dir.join("tokenbbq-aarch64-apple-darwin"),
                    dir.join("tokenbbq-x86_64-apple-darwin"),
                ]
            } else {
                vec![dir.join("tokenbbq")]
            };

            for c in &candidates {
                if c.exists() {
                    return Ok(invocation_for(c.clone()));
                }
                tried.push(format!("{} (missing)", c.display()));
            }
        } else {
            tried.push("current_exe has no parent".to_string());
        }
    } else {
        tried.push("current_exe failed".to_string());
    }

    if dev_fallback.exists() {
        return Ok(invocation_for(dev_fallback));
    }

    Err(format!("TokenBBQ sidecar not found. Tried: {}", tried.join(" | ")))
}

fn invocation_for(path: PathBuf) -> (PathBuf, Vec<String>) {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(ext.as_str(), "js" | "mjs" | "cjs") {
        (
            PathBuf::from("node"),
            vec![path.to_string_lossy().to_string(), "scan".to_string()],
        )
    } else {
        (path, vec!["scan".to_string()])
    }
}

/// Spawn TokenBBQ in dashboard (Hono server) mode and let it open the
/// browser itself. Detaches — the dashboard stays alive after the widget exits.
/// Re-clicking just spawns another instance; TokenBBQ's `findFreePort`
/// resolves port collisions transparently.
///
/// If TOKENBBQ_LOGO_PATH is set in the widget process environment, we
/// forward it so the dashboard renders that PNG. Without it the dashboard
/// renders its built-in inline SVG mark — both are TokenBBQ branding.
#[tauri::command]
pub async fn open_full_dashboard() -> Result<(), String> {
    let (program, args_orig) = resolve_tokenbbq_invocation()?;
    let args: Vec<String> = args_orig
        .into_iter()
        .map(|a| if a == "scan" { "dashboard".to_string() } else { a })
        .collect();

    let logo_path = std::env::var("TOKENBBQ_LOGO_PATH").ok();

    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&program);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Some(p) = logo_path.as_deref() {
            if std::path::Path::new(p).exists() {
                cmd.env("TOKENBBQ_LOGO_PATH", p);
            }
        }
        cmd.spawn()
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to launch TokenBBQ dashboard: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn fetch_local_usage() -> Result<LocalUsageSummary, String> {
    let (program, args) = resolve_tokenbbq_invocation()?;
    let program_display = program.display().to_string();

    // Hard 30-second timeout on the spawn so a hanging child process surfaces
    // as a visible error instead of leaving the JS Promise pending forever.
    // Bun-compiled binaries on Windows have been observed to hang during init
    // when spawned from a GUI parent; the timeout means the user gets feedback
    // either way.
    let join_handle = tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&program);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output()
    });

    let output = match tokio::time::timeout(std::time::Duration::from_secs(30), join_handle).await {
        Ok(Ok(Ok(out))) => out,
        Ok(Ok(Err(e))) => return Err(format!("Failed to spawn TokenBBQ ({}): {}", program_display, e)),
        Ok(Err(e)) => return Err(format!("Spawn task error: {}", e)),
        Err(_) => return Err(format!(
            "TokenBBQ scan timed out after 30s. Spawned: {}. Likely the bundled sidecar is hanging during init.",
            program_display
        )),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let preview: String = stderr.chars().take(300).collect();
        return Err(format!(
            "TokenBBQ scan exited {}: {} (program: {})",
            output.status.code().unwrap_or(-1),
            preview.trim(),
            program_display
        ));
    }

    if output.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let preview: String = stderr.chars().take(300).collect();
        return Err(format!(
            "TokenBBQ scan exited cleanly but produced no output. stderr: '{}'. program: {}",
            preview.trim(),
            program_display
        ));
    }

    // Parse the DashboardData JSON as Value and project down — avoids mirroring
    // every nested aggregation type from TokenBBQ. We only consume `generated`,
    // `daily`, and `dailyBySource`.
    let raw: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| {
            let preview: String = String::from_utf8_lossy(&output.stdout).chars().take(200).collect();
            format!("Could not parse TokenBBQ output: {}. First bytes: '{}'", e, preview)
        })?;

    let generated = raw
        .get("generated")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let daily = raw.get("daily").and_then(|v| v.as_array());

    // "Today" = the latest active day in the store. Avoids clock skew between
    // the widget's host and the user's last activity, and means the widget shows
    // sensible numbers right after midnight when no events have landed yet.
    let last_day = daily.and_then(|arr| arr.last());
    let today_date = last_day
        .and_then(|d| d.get("date"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let today_tokens = last_day
        .and_then(|d| d.get("tokens"))
        .map(sum_token_counts)
        .unwrap_or(0);

    let week_tokens: u64 = daily
        .map(|arr| {
            let n = arr.len();
            let start = n.saturating_sub(7);
            arr[start..]
                .iter()
                .map(|e| e.get("tokens").map(sum_token_counts).unwrap_or(0))
                .sum()
        })
        .unwrap_or(0);

    let today_by_source: Vec<SourceSpend> = match (today_date.as_deref(), raw.get("dailyBySource").and_then(|v| v.as_array())) {
        (Some(date), Some(arr)) => arr
            .iter()
            .filter(|e| e.get("date").and_then(|v| v.as_str()) == Some(date))
            .filter_map(|e| {
                Some(SourceSpend {
                    source: e.get("source")?.as_str()?.to_string(),
                    tokens: sum_token_counts(e.get("tokens")?),
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    // Schema-drift safety: log on deserialization failure rather than
    // silently swallowing — otherwise a sidecar shape change would
    // produce a `null` Codex toggle in the widget with no clue why.
    let codex_usage: Option<CodexUsage> = raw
        .get("codexRateLimits")
        .and_then(|v| if v.is_null() { None } else { Some(v.clone()) })
        .and_then(|v| {
            serde_json::from_value::<CodexUsage>(v)
                .map_err(|e| eprintln!("tokenbbq-widget: codexRateLimits deserialize failed: {e}"))
                .ok()
        });

    Ok(LocalUsageSummary {
        generated,
        today_date,
        today_tokens,
        week_tokens,
        today_by_source,
        codex_usage,
    })
}

/// Sum the conversational TokenCounts fields. We exclude both cache buckets:
/// `cacheRead` is re-sent prompt prefix, `cacheCreation` is the same content
/// being written to cache on the first send. For Claude Code's heavy-context
/// sessions cacheCreation can be 20x larger than real input+output, which
/// drowns the signal of "what did the user actually exchange with the model
/// today". Cost stays accurate because pricing.ts uses the full breakdown.
fn sum_token_counts(v: &serde_json::Value) -> u64 {
    const FIELDS: &[&str] = &["input", "output", "reasoning"];
    FIELDS
        .iter()
        .filter_map(|f| v.get(*f).and_then(|n| n.as_u64()))
        .sum()
}
