use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::api_types::{ClaudeUsageResponse, LocalUsageSummary, Settings, SettingsDisplay, SourceSpend};

const USER_AGENT: &str = concat!("TokenBBQ-Widget/", env!("CARGO_PKG_VERSION"));

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

async fn claude_get(client: &reqwest::Client, url: &str, session_key: &str) -> Result<reqwest::Response, String> {
    let resp = client
        .get(url)
        .header("Cookie", format!("sessionKey={}", session_key))
        .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("Session expired. Update your session key in Settings.".to_string());
    }
    if !status.is_success() {
        return Err(format!("API error: HTTP {}", status.as_u16()));
    }

    Ok(resp)
}

#[tauri::command]
pub async fn fetch_usage(app: AppHandle, client: State<'_, reqwest::Client>) -> Result<ClaudeUsageResponse, String> {
    let session_key = keyring_get_async()
        .await?
        .ok_or("No session key configured.")?;

    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let org_id = store
        .get("org_id")
        .and_then(|v| v.as_str().map(String::from))
        .ok_or("No organization ID configured.")?;

    if !is_valid_uuid(&org_id) {
        return Err("Invalid organization ID format.".to_string());
    }

    let url = format!("https://claude.ai/api/organizations/{}/usage", org_id);

    claude_get(&client, &url, &session_key)
        .await?
        .json::<ClaudeUsageResponse>()
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

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
        session_key,
        org_id: store.get("org_id").and_then(|v| v.as_str().map(String::from)),
        saved_at: store.get("saved_at").and_then(|v| v.as_u64()),
    })
}

#[tauri::command]
pub async fn auto_detect_org(client: State<'_, reqwest::Client>, session_key: String) -> Result<String, String> {
    if !is_valid_session_key(&session_key) {
        return Err("Invalid session key format.".to_string());
    }

    let resp = claude_get(&client, "https://claude.ai/api/organizations", &session_key).await?;

    let orgs: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;

    orgs.first()
        .and_then(|o| o["uuid"].as_str().map(String::from))
        .ok_or("No organizations found".to_string())
}

/// Resolve how to invoke TokenBBQ's `scan` subcommand. Returns the program +
/// argument list ready for std::process::Command. Resolution order:
///   1. TOKENBBQ_SIDECAR_PATH env var.
///   2. Bundled sidecar next to the widget binary — Tauri's `externalBin`
///      mechanism copies `binaries/tokenbbq-<triple>{.exe}` to the install
///      dir as `tokenbbq{.exe}`, so we look there first. This is the
///      production path on installed builds and `tauri dev`.
///   3. Dev fallback: `<repo>/dist/index.js` resolved relative to this crate's
///      manifest dir at compile time. Used when running the widget without
///      a freshly built sidecar (e.g. iterating on UI only).
fn resolve_tokenbbq_invocation() -> Result<(PathBuf, Vec<String>), String> {
    if let Ok(env_path) = std::env::var("TOKENBBQ_SIDECAR_PATH") {
        let p = PathBuf::from(&env_path);
        if !p.exists() {
            return Err(format!("TOKENBBQ_SIDECAR_PATH does not point to an existing file: {}", env_path));
        }
        return Ok(invocation_for(p));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bin_name = if cfg!(target_os = "windows") { "tokenbbq.exe" } else { "tokenbbq" };
            let bundled = dir.join(bin_name);
            if bundled.exists() {
                return Ok(invocation_for(bundled));
            }
        }
    }

    let dev_fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("dist")
        .join("index.js");
    if dev_fallback.exists() {
        return Ok(invocation_for(dev_fallback));
    }

    Err(format!(
        "TokenBBQ sidecar not found. Run `npm run build:sidecar` at the repo root, or set TOKENBBQ_SIDECAR_PATH explicitly. Looked for a bundled binary next to the widget exe and {}.",
        dev_fallback.display()
    ))
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

    // std::process::Command in spawn_blocking — keeps tokio dependencies minimal
    // (no need for the `process` feature flag) and the scan is short-lived.
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&program)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to spawn TokenBBQ: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let preview: String = stderr.chars().take(300).collect();
        return Err(format!(
            "TokenBBQ scan exited {}: {}",
            output.status.code().unwrap_or(-1),
            preview.trim()
        ));
    }

    // Parse the DashboardData JSON as Value and project down — avoids mirroring
    // every nested aggregation type from TokenBBQ. We only consume `generated`,
    // `daily`, and `dailyBySource`.
    let raw: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Could not parse TokenBBQ output: {}", e))?;

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

    Ok(LocalUsageSummary {
        generated,
        today_date,
        today_tokens,
        week_tokens,
        today_by_source,
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
