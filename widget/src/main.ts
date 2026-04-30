import { invoke } from "@tauri-apps/api/core";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ClaudeUsageResponse, LocalUsageSummary, Settings, SettingsDisplay } from "./types";
import { renderCompact, renderExpanded, renderError, renderLocalCompact, setViewState } from "./ui";

const SESSION_KEY_LIFETIME_MS = 28 * 24 * 60 * 60 * 1000;
const LOCAL_POLL_INTERVAL_MS = 5 * 60 * 1000;

let currentView: "compact" | "expanded" | "settings" = "compact";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let localPollTimer: ReturnType<typeof setInterval> | null = null;

let lastUsageJson = "";
let lastLocal: LocalUsageSummary | null = null;

async function fetchUsage(): Promise<void> {
  try {
    const usage = await invoke<ClaudeUsageResponse>("fetch_usage");
    const json = JSON.stringify(usage);
    if (json === lastUsageJson) return;
    lastUsageJson = json;
    renderCompact(usage);
    renderExpanded(usage, lastLocal);
  } catch (e) {
    renderError(String(e));
  }
}

// Local AI tool data lives in TokenBBQ's NDJSON store and is far cheaper to
// scan than the claude.ai roundtrip — but we still poll less aggressively
// (5 min) since there's no real-time signal here. The sidecar process is
// short-lived (~2s for ~20k events on disk) so this is fine.
async function fetchLocalUsage(): Promise<void> {
  try {
    const local = await invoke<LocalUsageSummary>("fetch_local_usage");
    lastLocal = local;
    renderLocalCompact(local);
    // Re-render the expanded panel only if it's currently mounted; the
    // claude.ai poll will pick up `lastLocal` next time it fires anyway.
    if (lastUsageJson) {
      try {
        const usage = JSON.parse(lastUsageJson) as ClaudeUsageResponse;
        renderExpanded(usage, local);
      } catch {}
    }
  } catch (e) {
    // Surface the full error message in the expanded panel so users can see
    // why local data is missing without needing DevTools (which prod builds
    // don't expose). Production troubleshooting beats clean degradation here.
    console.warn("fetch_local_usage failed:", e);
    lastLocal = null;
    renderLocalCompact(null);
    const container = document.getElementById("usage-bars");
    if (container) {
      const existing = container.querySelector(".local-error") as HTMLElement | null;
      const msg = `Local AI tools unavailable.\n\n${String(e)}`;
      if (existing) {
        existing.textContent = msg;
      } else {
        const div = document.createElement("div");
        div.className = "local-error";
        div.style.cssText = "margin-top:10px;padding:8px 10px;border:1px solid var(--red);border-radius:6px;color:var(--red);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:rgba(239,68,68,0.05)";
        div.textContent = msg;
        container.appendChild(div);
      }
    }
  }
}

function startPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (localPollTimer) clearInterval(localPollTimer);
  fetchUsage();
  fetchLocalUsage();
  pollTimer = setInterval(fetchUsage, 60_000);
  localPollTimer = setInterval(fetchLocalUsage, LOCAL_POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (localPollTimer) {
    clearInterval(localPollTimer);
    localPollTimer = null;
  }
}

async function init(): Promise<void> {
  // WebView2 on Windows renders an opaque default background even when the
  // window is set to transparent — the result is a grey rectangle around the
  // rounded pill. Forcing the webview's background to fully transparent
  // (alpha 0) makes Windows actually honour the window-level transparency.
  // No-op on macOS where macos-private-api already takes care of it.
  try {
    await getCurrentWebview().setBackgroundColor({ red: 0, green: 0, blue: 0, alpha: 0 });
  } catch {
    // Older Tauri versions / unsupported platforms — fall through.
  }

  const settings = await invoke<SettingsDisplay>("load_settings");

  if (settings.has_session_key) {
    // Resync window size to compact in case a Vite hot-reload (or any prior
    // state desync) left the window at expanded dimensions while the JS
    // state booted in compact mode.
    await setViewState("compact");
    startPolling();
  } else {
    await expand();
    openSettings();
  }

  const win = getCurrentWindow();
  win.onCloseRequested(async (event) => {
    event.preventDefault();
    stopPolling();
    await win.hide();
  });

  // Tray "Refresh" → refresh both halves of the pill, matching the in-UI
  // refresh button. Without this the tray menu silently leaves local-tool
  // totals stale.
  listen("refresh-usage", () => {
    fetchUsage();
    fetchLocalUsage();
  });
  listen("resume-polling", () => startPolling());
  setupEventListeners();
  setupDragRegions();
}

async function expand(): Promise<void> {
  currentView = "expanded";
  await setViewState("expanded");
}

async function collapse(): Promise<void> {
  currentView = "compact";
  await setViewState("compact");
}

async function openSettings(): Promise<void> {
  currentView = "settings";
  setViewState("settings");

  try {
    const settings = await invoke<SettingsDisplay>("load_settings");
    const keyInput = document.getElementById("session-key-input") as HTMLInputElement;
    if (settings.session_key)
      keyInput.value = settings.session_key;
    else
      keyInput.value = "";
    if (settings.org_id)
      (document.getElementById("org-id-input") as HTMLInputElement).value = settings.org_id;

    if (settings.saved_at) {
      const expiresAt = settings.saved_at * 1000 + SESSION_KEY_LIFETIME_MS;
      const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
      const el = document.getElementById("import-status")!;
      if (daysLeft <= 5) {
        el.textContent = `Session key expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;
        el.className = "import-status error";
      } else {
        el.textContent = `Session key valid for ~${daysLeft} days.`;
        el.className = "import-status success";
      }
    }
  } catch {}
}

function closeSettings(): void {
  currentView = "expanded";
  document.getElementById("settings-overlay")!.classList.remove("visible");
}

async function saveSettings(): Promise<void> {
  const sessionKey = (document.getElementById("session-key-input") as HTMLInputElement).value.trim() || null;
  let orgId = (document.getElementById("org-id-input") as HTMLInputElement).value.trim() || null;

  const statusEl = document.getElementById("import-status")!;

  // Session key required on first setup; subsequent saves can omit it to keep existing key
  const currentSettings = await invoke<SettingsDisplay>("load_settings");
  if (!sessionKey && !currentSettings.has_session_key) {
    statusEl.textContent = "Session key is required.";
    statusEl.className = "import-status error";
    return;
  }

  if (!orgId && sessionKey) {
    statusEl.textContent = "Detecting organization...";
    statusEl.className = "import-status loading";
    try {
      orgId = await invoke<string>("auto_detect_org", { sessionKey });
      (document.getElementById("org-id-input") as HTMLInputElement).value = orgId;
    } catch (e) {
      statusEl.textContent = "Could not detect Org ID: " + String(e);
      statusEl.className = "import-status error";
      return;
    }
  }

  try {
    await invoke("save_settings", {
      settings: { session_key: sessionKey, org_id: orgId },
    });
    closeSettings();
    startPolling();
  } catch (e) {
    statusEl.textContent = String(e);
    statusEl.className = "import-status error";
  }
}

// --- Drag & Events ---

function setupDragRegions(): void {
  const grip = document.getElementById("pill-grip")!;
  grip.addEventListener("mousedown", async (e) => {
    e.stopPropagation();
    await getCurrentWindow().startDragging();
  });
  // After a drag, the browser still dispatches a click on the grip (mousedown
  // + mouseup on the same element). That click would bubble up to compact-view
  // and trigger expand(). Swallow it.
  grip.addEventListener("click", (e) => e.stopPropagation());

  document.querySelectorAll(".titlebar").forEach((el) => {
    el.addEventListener("mousedown", async (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      await getCurrentWindow().startDragging();
    });
  });
}

function setupEventListeners(): void {
  document.getElementById("compact-view")!.addEventListener("click", expand);
  document.getElementById("btn-minimize")!.addEventListener("click", collapse);
  document.getElementById("btn-close")!.addEventListener("click", async () => {
    await getCurrentWindow().hide();
  });

  document.getElementById("btn-settings")!.addEventListener("click", async () => {
    if (currentView !== "expanded") await expand();
    openSettings();
  });

  document.getElementById("btn-refresh")!.addEventListener("click", () => {
    const btn = document.getElementById("btn-refresh")!;
    btn.classList.add("refreshing");
    Promise.allSettled([fetchUsage(), fetchLocalUsage()]).finally(() =>
      setTimeout(() => btn.classList.remove("refreshing"), 500),
    );
  });

  document.getElementById("btn-save-settings")!.addEventListener("click", saveSettings);
  document.getElementById("btn-cancel-settings")!.addEventListener("click", closeSettings);
  document.getElementById("btn-cancel-settings-2")!.addEventListener("click", closeSettings);

  // Delegated: the button is re-rendered with the expanded panel on every
  // refresh, so a static handle would go stale.
  document.getElementById("usage-bars")!.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("#btn-open-dashboard");
    if (!btn) return;
    (btn as HTMLButtonElement).disabled = true;
    try {
      await invoke("open_full_dashboard");
    } catch (err) {
      console.warn("open_full_dashboard failed:", err);
    } finally {
      setTimeout(() => ((btn as HTMLButtonElement).disabled = false), 1500);
    }
  });

  document.querySelectorAll(".toggle-vis").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement!.querySelector("input") as HTMLInputElement;
      input.type = input.type === "password" ? "text" : "password";
    });
  });

  // Autostart
  const autostartToggle = document.getElementById("autostart-toggle") as HTMLInputElement;
  isEnabled().then((enabled) => { autostartToggle.checked = enabled; });
  autostartToggle.addEventListener("change", async () => {
    if (autostartToggle.checked) {
      await enable();
    } else {
      await disable();
    }
  });

  // Theme
  const themeToggle = document.getElementById("theme-toggle") as HTMLInputElement;
  const savedTheme = localStorage.getItem("tokenbbq-theme") || "dark";
  applyTheme(savedTheme);
  themeToggle.checked = savedTheme === "light";
  themeToggle.addEventListener("change", () => {
    const theme = themeToggle.checked ? "light" : "dark";
    applyTheme(theme);
    localStorage.setItem("tokenbbq-theme", theme);
  });
}

function applyTheme(theme: string): void {
  document.documentElement.classList.remove("theme-dark", "theme-light");
  document.documentElement.classList.add(`theme-${theme}`);
  document.getElementById("theme-label-dark")!.classList.toggle("active", theme === "dark");
  document.getElementById("theme-label-light")!.classList.toggle("active", theme === "light");
}

document.addEventListener("DOMContentLoaded", init);
