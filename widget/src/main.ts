import { invoke } from "@tauri-apps/api/core";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ClaudeUsageResponse, LocalUsageSummary, Settings, SettingsDisplay } from "./types";
import { loadToggleState, saveToggleState, resolveMode, type SourceToggleState } from "./source-toggle";
import { renderCompact, renderExpanded, renderError, renderLocalCompact, setViewState, getWorkAreaPhysical, currentFrameInsetLogical, clampWindowToWorkAreaOnce, refreshPillPositionIfPillMode, setMonitorWorkAreaPhysical } from "./ui";

const SESSION_KEY_LIFETIME_MS = 28 * 24 * 60 * 60 * 1000;
const LOCAL_POLL_INTERVAL_MS = 5 * 60 * 1000;
// Persistent cache of the last successful fetchLocalUsage result. Codex /
// local-AI scanning runs in a sidecar that takes ~2s on startup; without
// the cache the UI shows blank Codex tiles for those 2s every time the
// widget restarts. With it, the previous-session value renders instantly
// and the live result quietly replaces it once the sidecar completes.
const LOCAL_CACHE_KEY = "tokenbbq-local-usage-cache";

function loadCachedLocalUsage(): LocalUsageSummary | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalUsageSummary;
  } catch {
    return null;
  }
}

function saveCachedLocalUsage(local: LocalUsageSummary): void {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(local));
  } catch {
    // localStorage may be disabled / quota exceeded — non-fatal.
  }
}

let currentView: "compact" | "expanded" | "settings" = "compact";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let localPollTimer: ReturnType<typeof setInterval> | null = null;

let lastUsageJson = "";
let lastLocal: LocalUsageSummary | null = null;
let toggleState: SourceToggleState = loadToggleState();

function currentMode() {
  const usage = lastUsageJson ? JSON.parse(lastUsageJson) as ClaudeUsageResponse : null;
  const hasClaude = !!(usage?.five_hour || usage?.seven_day);
  const codex = lastLocal?.codexUsage ?? null;
  const hasCodex = !!(codex && codex.planType !== null
    && (codex.primary || codex.secondary));
  return resolveMode(toggleState, hasClaude, hasCodex);
}

async function fetchUsage(): Promise<void> {
  try {
    const usage = await invoke<ClaudeUsageResponse>("fetch_usage");
    const json = JSON.stringify(usage);
    if (json === lastUsageJson) return;
    lastUsageJson = json;
    renderCompact(usage, lastLocal, toggleState);
    renderExpanded(usage, lastLocal, toggleState);
    // Sync window size to mode — covers the case where dev-mode CSS
    // edits change the dual-mode dimensions but the user hasn't
    // toggled to trigger a setSize.
    if (currentView === "compact") {
      setViewState("compact", currentMode()).catch(() => {});
    }
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
    saveCachedLocalUsage(local);
    renderLocalCompact(local);
    // Re-render pill + expanded if we already have claude data. Otherwise
    // the pill would show stale Codex data (or none) for up to 60s while
    // the claude.ai poll catches up — visible especially right after the
    // user starts Codex with the Codex toggle already on.
    if (lastUsageJson) {
      try {
        const usage = JSON.parse(lastUsageJson) as ClaudeUsageResponse;
        renderCompact(usage, local, toggleState);
        renderExpanded(usage, local, toggleState);
        if (currentView === "compact") {
          setViewState("compact", currentMode()).catch(() => {});
        }
      } catch {}
    }
  } catch (e) {
    // Sidecar unavailable / errored → degrade gracefully: hide the local zone,
    // keep claude.ai data visible. Console-only so we don't drown the user.
    console.warn("fetch_local_usage failed:", e);
    lastLocal = null;
    renderLocalCompact(null);
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

  // Pre-populate from the on-disk cache so Codex / local-AI tiles render
  // instantly on startup. The fresh sidecar scan kicks off a moment later
  // in startPolling() and overwrites lastLocal once it returns.
  const cached = loadCachedLocalUsage();
  if (cached) {
    lastLocal = cached;
    renderLocalCompact(cached);
  }

  const settings = await invoke<SettingsDisplay>("load_settings");
  await refreshMonitorWorkArea();

  if (settings.has_session_key) {
    // Resync window size to compact in case a Vite hot-reload (or any prior
    // state desync) left the window at expanded dimensions while the JS
    // state booted in compact mode.
    await setViewState("compact", currentMode());
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
  // If a previously-saved pill position is outside the current work area
  // (e.g. taskbar moved, display changed), pull it back in once at startup.
  // No continuous listener — drag itself clamps inline in setupDragRegions.
  clampWindowToWorkAreaOnce().catch(() => {});
}

// Onboarding: surface the double-click-to-minimize gesture the first two
// times the user opens the panel, then never again. Counter survives
// across restarts via localStorage. We deliberately don't clear it on
// successful collapse — the user said "show it twice", not "show until
// they figure it out".
const DBLCLICK_HINT_KEY = "tokenbbq-dblclick-hint-count";
const DBLCLICK_HINT_MAX = 2;
// Wait for the panel's own expand animation to settle before springing the
// hint in — otherwise the two motions overlap and the hint reads as instant.
const DBLCLICK_HINT_DELAY_MS = 450;
const DBLCLICK_HINT_VISIBLE_MS = 3500;
const DBLCLICK_HINT_FADE_MS = 400;
let dblclickHintDelayTimer: ReturnType<typeof setTimeout> | null = null;
let dblclickHintShowTimer: ReturnType<typeof setTimeout> | null = null;
let dblclickHintHideTimer: ReturnType<typeof setTimeout> | null = null;

function maybeShowDblclickHint(): void {
  const seen = parseInt(localStorage.getItem(DBLCLICK_HINT_KEY) ?? "0", 10);
  if (Number.isNaN(seen) || seen >= DBLCLICK_HINT_MAX) return;

  const hint = document.getElementById("dblclick-hint");
  if (!hint) return;

  // Cancel any in-flight show/hide from a previous expand so we don't
  // double-trigger when the user rapidly toggles compact↔expanded.
  if (dblclickHintDelayTimer) clearTimeout(dblclickHintDelayTimer);
  if (dblclickHintShowTimer) clearTimeout(dblclickHintShowTimer);
  if (dblclickHintHideTimer) clearTimeout(dblclickHintHideTimer);

  localStorage.setItem(DBLCLICK_HINT_KEY, String(seen + 1));

  dblclickHintDelayTimer = setTimeout(() => {
    hint.removeAttribute("hidden");
    // Two rAFs so the browser commits `display: flex` before we add the
    // .visible class — without this the transition has nothing to interpolate
    // from and the toast snaps in instantly.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      hint.classList.add("visible");
    }));

    dblclickHintShowTimer = setTimeout(() => {
      hint.classList.remove("visible");
      dblclickHintHideTimer = setTimeout(() => {
        hint.setAttribute("hidden", "");
      }, DBLCLICK_HINT_FADE_MS);
    }, DBLCLICK_HINT_VISIBLE_MS);
  }, DBLCLICK_HINT_DELAY_MS);
}

async function expand(): Promise<void> {
  currentView = "expanded";
  await setViewState("expanded");
  maybeShowDblclickHint();
}

async function collapse(): Promise<void> {
  currentView = "compact";
  await setViewState("compact", currentMode());
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

// JS-controlled drag. We don't use Tauri's startDragging() because that
// hands the cursor over to Windows' native drag modal — and during that
// modal we can't prevent the window from being dragged past the taskbar
// or off-screen (every async setPosition we make gets immediately
// overridden by the next OS-level mouse update). Doing the drag
// ourselves means we set the position synchronously per pointermove and
// can clamp BEFORE positioning, so the window literally cannot leave the
// work area.
interface DragState {
  startScreenX: number;  // CSS px, where the cursor was on pointerdown
  startScreenY: number;
  startWinX: number;     // physical px, where the window was on pointerdown
  startWinY: number;
  winW: number;          // physical px, window size (constant during drag)
  winH: number;
  pointerId: number;
  capturer: HTMLElement;
  moved: boolean;        // crossed the click-vs-drag threshold yet?
}
const DRAG_THRESHOLD_PHYS_PX = 3;
let activeDrag: DragState | null = null;

async function refreshMonitorWorkArea(): Promise<void> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length === 0) {
      setMonitorWorkAreaPhysical(null);
      return;
    }
    setMonitorWorkAreaPhysical(monitors.reduce((area, monitor) => {
      const x = monitor.workArea.position.x;
      const y = monitor.workArea.position.y;
      const right = x + monitor.workArea.size.width;
      const bottom = y + monitor.workArea.size.height;
      return {
        minX: Math.min(area.minX, x),
        minY: Math.min(area.minY, y),
        maxX: Math.max(area.maxX, right),
        maxY: Math.max(area.maxY, bottom),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }));
  } catch (err) {
    console.warn('refreshMonitorWorkArea failed:', err);
    setMonitorWorkAreaPhysical(null);
  }
}

async function beginJsDrag(e: PointerEvent, capturer: HTMLElement): Promise<void> {
  if (e.button !== 0) return;
  try {
    await refreshMonitorWorkArea();
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const size = await win.outerSize();
    activeDrag = {
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startWinX: pos.x,
      startWinY: pos.y,
      winW: size.width,
      winH: size.height,
      pointerId: e.pointerId,
      capturer,
      moved: false,
    };
    capturer.setPointerCapture(e.pointerId);
  } catch (err) {
    console.warn('beginJsDrag failed:', err);
  }
}

function onJsDragMove(e: PointerEvent): void {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
  const dpr = window.devicePixelRatio || 1;
  const dxPhys = Math.round((e.screenX - activeDrag.startScreenX) * dpr);
  const dyPhys = Math.round((e.screenY - activeDrag.startScreenY) * dpr);
  if (!activeDrag.moved) {
    if (Math.abs(dxPhys) < DRAG_THRESHOLD_PHYS_PX && Math.abs(dyPhys) < DRAG_THRESHOLD_PHYS_PX) return;
    activeDrag.moved = true;
  }
  let targetX = activeDrag.startWinX + dxPhys;
  let targetY = activeDrag.startWinY + dyPhys;
  // Clamp BEFORE setPosition so the window never visits an out-of-bounds spot.
  // currentFrameInsetLogical() picks the pill's 6-px margin compensation when
  // dragging the compact pill, 0 when dragging the expanded panel — keeps the
  // *visible* element the same distance from the screen edge in both modes.
  const work = getWorkAreaPhysical(currentFrameInsetLogical());
  if (work) {
    targetX = Math.max(work.minX, Math.min(targetX, work.maxX - activeDrag.winW));
    targetY = Math.max(work.minY, Math.min(targetY, work.maxY - activeDrag.winH));
  }
  // Fire-and-forget: awaiting would make moves stutter.
  getCurrentWindow().setPosition(new PhysicalPosition(targetX, targetY)).catch(() => {});
}

function endJsDrag(e: PointerEvent): void {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
  const moved = activeDrag.moved;
  try {
    activeDrag.capturer.releasePointerCapture(activeDrag.pointerId);
  } catch {}
  activeDrag = null;
  // If the user actually moved the window (not just clicked), and we ended
  // up in pill mode, freshen the pill's home so the next expand/collapse
  // cycle anchors to the new spot. No-op in panel mode — panel drags don't
  // move the pill's home.
  if (moved) {
    refreshPillPositionIfPillMode().catch(() => {});
  }
}

function setupDragRegions(): void {
  const grip = document.getElementById("pill-grip")!;
  grip.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    void beginJsDrag(e, grip);
  });
  grip.addEventListener("pointermove", onJsDragMove);
  grip.addEventListener("pointerup", endJsDrag);
  grip.addEventListener("pointercancel", endJsDrag);
  // After a drag, the browser still dispatches a click on the grip. That
  // click would bubble up to compact-view and trigger expand(). Swallow.
  grip.addEventListener("click", (e) => e.stopPropagation());

  // Two presses on the same titlebar within 350ms collapse the panel
  // instead of starting a drag. (Native dblclick events are unreliable
  // when we're capturing the pointer ourselves, so we time mousedown
  // intervals manually.)
  let lastTitlebarMousedown = 0;
  const DBLCLICK_MS = 350;
  document.querySelectorAll(".titlebar").forEach((el) => {
    const isExpandedPanelTitlebar = !el.closest("#settings-overlay");
    const tEl = el as HTMLElement;
    tEl.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      if (e.button !== 0) return;
      const now = Date.now();
      if (
        isExpandedPanelTitlebar
        && currentView === "expanded"
        && now - lastTitlebarMousedown < DBLCLICK_MS
      ) {
        lastTitlebarMousedown = 0;
        void collapse();
        return;
      }
      lastTitlebarMousedown = now;
      void beginJsDrag(e, tEl);
    });
    tEl.addEventListener("pointermove", onJsDragMove);
    tEl.addEventListener("pointerup", endJsDrag);
    tEl.addEventListener("pointercancel", endJsDrag);
  });
}

function setupEventListeners(): void {
  document.getElementById("compact-view")!.addEventListener("click", expand);
  document.getElementById("btn-minimize")!.addEventListener("click", collapse);

  // Double-click anywhere in the expanded panel collapses back to the pill —
  // a faster shortcut than aiming for the small minus icon. Interactive
  // elements (buttons, inputs, toggles) keep their native double-click
  // behavior so e.g. selecting a word in the session-key field still works.
  document.getElementById("expanded-view")!.addEventListener("dblclick", (e) => {
    if (currentView !== "expanded") return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, label, .source-toggle-switch, .field-input-wrap")) return;
    void collapse();
  });
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

  document.getElementById("usage-bars")!.addEventListener("change", async (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === "toggle-claude") toggleState.claude = target.checked;
    else if (target.id === "toggle-codex") toggleState.codex = target.checked;
    else return;
    saveToggleState(toggleState);

    // Snapshot the mode once so renderCompact and setViewState see the
    // same value even though the latter is async. If the user fires two
    // toggle changes in rapid succession the second handler reads the
    // toggleState mutated by the first — accepted for V1 (the worst
    // case is one extra render cycle).
    const mode = currentMode();

    // Resize FIRST, then mutate DOM. Otherwise the second row appears
    // for one paint frame inside a still-64px window and gets clipped —
    // visible flash on Windows/WebView2 when toggling into dual-mode.
    if (currentView === "compact") {
      await setViewState("compact", mode);
    }
    if (lastUsageJson) {
      try {
        const usage = JSON.parse(lastUsageJson) as ClaudeUsageResponse;
        renderCompact(usage, lastLocal, toggleState);
        renderExpanded(usage, lastLocal, toggleState);
      } catch {}
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
