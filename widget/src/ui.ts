import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { ClaudeUsageResponse, LocalUsageSummary, ViewState } from "./types";
import { resolveMode, type SourceMode, type SourceToggleState } from "./source-toggle";

const COMPACT_SIZE_SINGLE = { width: 320, height: 64 };
// Dual-mode needs more horizontal room than single — 2 uniform 76px
// chips + divider/today/grip won't fit at 320. 340 has breathing room.
// Pill is 120px tall; +12px margin +2px WebView2 buffer = 134 height.
const COMPACT_SIZE_DUAL = { width: 340, height: 134 };

function compactSizeForMode(mode: SourceMode): { width: number; height: number } {
  return mode === 'both' ? COMPACT_SIZE_DUAL : COMPACT_SIZE_SINGLE;
}
const EXPANDED_WIDTH = 320;
// Initial guess; the real height is recomputed from content via fitExpandedToContent.
const EXPANDED_INITIAL_HEIGHT = 320;
// Hard ceiling so a runaway list never grows past a usable widget — content
// scrolls inside the panel instead.
const EXPANDED_MAX_HEIGHT = 720;
const EXPANDED_MIN_HEIGHT = 220;

// Mirror of TokenBBQ's SOURCE_LABELS / SOURCE_COLORS (src/types.ts upstream).
// Keep these in sync with the Source union over there. Anything we receive
// that's not in this map falls back to a neutral grey + raw key.
const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  amp: "Amp",
  pi: "Pi-Agent",
};

const SOURCE_COLORS: Record<string, string> = {
  "claude-code": "#c15f3c",
  codex: "#74aa9c",
  gemini: "#1A73E8",
  opencode: "#6366F1",
  amp: "#F59E0B",
  pi: "#8B5CF6",
};

function sourceLabel(s: string): string {
  return SOURCE_LABELS[s] ?? s;
}

function sourceColor(s: string): string {
  return SOURCE_COLORS[s] ?? "#9CA3AF";
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

type ColorTier = "green" | "orange" | "red";

function colorTier(pct: number): ColorTier {
  if (pct < 50) return "green";
  if (pct < 80) return "orange";
  return "red";
}

export function utilizationColor(pct: number): string {
  return `var(--${colorTier(pct)})`;
}

// Compact pill labels: just the unit-of-time-until-reset, no prose. Returns
// "" when we don't have a timestamp yet so callers can fall back to a static
// placeholder instead of rendering an empty label.
function formatHoursCompact(isoString: string | null): string {
  if (!isoString) return "";
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs <= 0) return "0m";
  const totalMin = Math.round(diffMs / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.round(totalMin / 60)}h`;
}

function formatDaysCompact(isoString: string | null): string {
  if (!isoString) return "";
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs <= 0) return "0d";
  return `${Math.ceil(diffMs / 86400000)}d`;
}

// Monochrome brand marks — small (14-18 px slot), tint via currentColor
// so they pick up the foreground in both dark and light themes.
// Claude: stylized burst/sparkle shape (Anthropic's brand language).
// Codex/OpenAI: simplified knot/loop motif (OpenAI's brand language).
// Simplified silhouettes, not pixel-exact replicas of the official marks.
const claudeBadgeSvg = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 L13.2 9.4 L20 7.5 L14.5 12 L20 16.5 L13.2 14.6 L12 22 L10.8 14.6 L4 16.5 L9.5 12 L4 7.5 L10.8 9.4 Z"/></svg>`;
const codexBadgeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/></svg>`;

function toggleRowHtml(
  id: string,
  label: string,
  logoSvg: string,
  checked: boolean,
  disabled: boolean,
  hint?: string,
): string {
  return `
    <div class="source-toggle-row${disabled ? ' disabled' : ''}">
      <span class="source-toggle-logo">${logoSvg}</span>
      <span class="source-toggle-label">${label}${hint ? `<span class="source-toggle-hint">${hint}</span>` : ''}</span>
      <label class="source-toggle-switch">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="source-toggle-slider"></span>
      </label>
    </div>`;
}

export function renderCompact(
  usage: ClaudeUsageResponse,
  local: LocalUsageSummary | null,
  toggleState: SourceToggleState,
): void {
  const codex = local?.codexUsage ?? null;
  const hasClaude = !!(usage.five_hour || usage.seven_day);
  const hasCodex = codex !== null && codex.planType !== null
    && (codex.primary !== null || codex.secondary !== null);
  const mode = resolveMode(toggleState, hasClaude, hasCodex);

  const fiveHour = document.getElementById("five-hour-compact")! as HTMLElement;
  const sevenDay = document.getElementById("seven-day-compact")! as HTMLElement;
  const fiveHourLabel = document.getElementById("five-hour-label")!;
  const sevenDayLabel = document.getElementById("seven-day-label")!;

  // Helper: reset to single-row layout (hide secondary row).
  // Logos are intentionally NEVER shown in either row — the user's UX
  // call. We keep the slots in the HTML so a future redesign can place
  // brand marks elsewhere (e.g. as a footnote) without re-wiring.
  function setSingleRowVisibility(): void {
    document.getElementById('pill-row-secondary')!.setAttribute('hidden', '');
  }

  if (mode === 'both' && codex) {
    // Dual-mode: just show the second row. Both logos stay hidden by
    // default (set in HTML); we don't populate them here.
    document.getElementById('pill-row-secondary')!.removeAttribute('hidden');

    // Primary row = Claude
    const fhPctC = usage.five_hour?.utilization ?? 0;
    const sdPctC = usage.seven_day?.utilization ?? 0;
    fiveHour.textContent = `${Math.round(fhPctC)}%`;
    fiveHour.style.color = utilizationColor(fhPctC);
    sevenDay.textContent = `${Math.round(sdPctC)}%`;
    sevenDay.style.color = utilizationColor(sdPctC);
    fiveHourLabel.textContent = formatHoursCompact(usage.five_hour?.resets_at ?? null) || "5h";
    sevenDayLabel.textContent = formatDaysCompact(usage.seven_day?.resets_at ?? null) || "7d";

    // Secondary row = Codex
    const fhPctX = codex.primary?.utilization ?? 0;
    const sdPctX = codex.secondary?.utilization ?? 0;
    const fh2 = document.getElementById('five-hour-compact-2')! as HTMLElement;
    const sd2 = document.getElementById('seven-day-compact-2')! as HTMLElement;
    const fh2l = document.getElementById('five-hour-label-2')!;
    const sd2l = document.getElementById('seven-day-label-2')!;
    fh2.textContent = `${Math.round(fhPctX)}%`;
    fh2.style.color = utilizationColor(fhPctX);
    sd2.textContent = `${Math.round(sdPctX)}%`;
    sd2.style.color = utilizationColor(sdPctX);
    fh2l.textContent = formatHoursCompact(codex.primary?.resetsAt ?? null) || "5h";
    sd2l.textContent = formatDaysCompact(codex.secondary?.resetsAt ?? null) || "7d";
    return;
  }

  if (mode === 'codex' && codex) {
    setSingleRowVisibility();
    const fhPct = codex.primary?.utilization ?? 0;
    const sdPct = codex.secondary?.utilization ?? 0;
    fiveHour.textContent = `${Math.round(fhPct)}%`;
    fiveHour.style.color = utilizationColor(fhPct);
    sevenDay.textContent = `${Math.round(sdPct)}%`;
    sevenDay.style.color = utilizationColor(sdPct);
    fiveHourLabel.textContent = formatHoursCompact(codex.primary?.resetsAt ?? null) || "5h";
    sevenDayLabel.textContent = formatDaysCompact(codex.secondary?.resetsAt ?? null) || "7d";
    return;
  }

  // Default (claude single layout).
  setSingleRowVisibility();
  const fhPct = usage.five_hour?.utilization ?? 0;
  const sdPct = usage.seven_day?.utilization ?? 0;
  fiveHour.textContent = `${Math.round(fhPct)}%`;
  fiveHour.style.color = utilizationColor(fhPct);
  sevenDay.textContent = `${Math.round(sdPct)}%`;
  sevenDay.style.color = utilizationColor(sdPct);
  fiveHourLabel.textContent = formatHoursCompact(usage.five_hour?.resets_at ?? null) || "5h";
  sevenDayLabel.textContent = formatDaysCompact(usage.seven_day?.resets_at ?? null) || "7d";
}

/// Render the local-AI-tools half of the compact pill. Pass null to hide the
/// divider + today zone entirely (e.g. sidecar not configured or scan failed).
export function renderLocalCompact(local: LocalUsageSummary | null): void {
  const divider = document.getElementById("pill-divider")!;
  const local_zone = document.getElementById("pill-local")!;
  const today = document.getElementById("today-compact")!;

  if (!local) {
    divider.hidden = true;
    local_zone.hidden = true;
    return;
  }

  divider.hidden = false;
  local_zone.hidden = false;
  today.textContent = formatTokens(local.todayTokens);
}

export function renderExpanded(
  usage: ClaudeUsageResponse,
  local: LocalUsageSummary | null = null,
  toggleState: SourceToggleState = { claude: true, codex: false },
): void {
  const container = document.getElementById("usage-bars")!;

  const codex = local?.codexUsage ?? null;
  const codexAvailable = codex !== null && codex.planType !== null;
  const codexHint = codex === null
    ? '(no data)'
    : (codex.planType === null ? '(API key — no plan)' : '');

  let html = `<div class="section-header">Pill displays</div>`;
  html += `<div class="source-toggle-list">`;
  html += toggleRowHtml('toggle-claude', 'Claude Code', claudeBadgeSvg, toggleState.claude, false);
  html += toggleRowHtml('toggle-codex', 'Codex', codexBadgeSvg, toggleState.codex && codexAvailable, !codexAvailable, codexHint);
  html += `</div>`;

  if (usage.extra_usage && usage.extra_usage.is_enabled) {
    const ex = usage.extra_usage;
    const pct = ex.utilization ?? 0;
    const used = ex.used_credits ?? 0;
    const limit = ex.monthly_limit ?? 0;
    const tier = colorTier(pct);
    const color = `var(--${tier})`;
    const glow = `var(--${tier}-glow)`;
    html += `
      <div class="usage-row">
        <div class="usage-row-header">
          <span class="usage-row-name"><span class="dot" style="background:${color};box-shadow:0 0 4px ${glow}"></span>Extra Usage</span>
          <span class="credits-amount">
            <span class="used">&euro;${(used / 100).toFixed(2)}</span><span class="sep">/</span><span class="total">&euro;${(limit / 100).toFixed(0)}</span>
          </span>
        </div>
        <div class="progress-track"><div class="progress-fill ${tier}" style="width:${pct}%"></div></div>
        <div class="credits-pct">${pct.toFixed(1)}%</div>
      </div>`;
  }

  if (local) {
    html += renderLocalExpandedHtml(local);
  }

  container.innerHTML = html;

  // Resize the host window to fit whatever we just rendered. Two rAFs because
  // the first one fires before the browser has reflowed the new innerHTML;
  // measuring then would still see the old layout.
  if (document.getElementById("expanded-view")!.classList.contains("visible")) {
    requestAnimationFrame(() => requestAnimationFrame(() => { void fitExpandedToContent(); }));
  }
}

function renderLocalExpandedHtml(local: LocalUsageSummary): string {
  const sources = [...local.todayBySource].sort((a, b) => b.tokens - a.tokens);
  const dateLabel = local.todayDate ? formatRelativeDate(local.todayDate) : "—";

  let inner = "";
  if (sources.length === 0) {
    inner = `<div class="local-empty">No activity yet today across local AI tools.</div>`;
  } else {
    // Bars are scaled relative to the largest source, not to the daily total —
    // gives a clearer visual ranking when one tool dominates.
    const maxTokens = Math.max(...sources.map((s) => s.tokens), 1);
    inner = sources
      .map((s) => {
        const color = sourceColor(s.source);
        const widthPct = Math.max(2, (s.tokens / maxTokens) * 100);
        return `
        <div class="local-row">
          <div class="local-row-header">
            <span class="local-row-name"><span class="dot" style="background:${color};box-shadow:0 0 4px ${color}66"></span>${escapeHtml(sourceLabel(s.source))}</span>
            <span class="local-row-cost">${formatTokens(s.tokens)}<span class="local-row-cost-unit"> tok</span></span>
          </div>
          <div class="local-row-bar-wrap">
            <div class="local-row-bar" style="width:${widthPct.toFixed(1)}%;background:${color}"></div>
          </div>
        </div>`;
      })
      .join("");
  }

  return `
    <div class="section-header local-section-header">
      <div class="local-header-titles">
        <span class="local-header-title">Local AI Tools</span>
        <span class="local-header-date">${escapeHtml(dateLabel)}</span>
      </div>
      <div class="local-header-stats">
        <span class="local-header-today">${formatTokens(local.todayTokens)}<span class="local-header-unit"> tok</span></span>
        <span class="local-header-week">${formatTokens(local.weekTokens)} · 7d</span>
      </div>
    </div>
    ${inner}
    <button class="open-dashboard-btn" id="btn-open-dashboard">
      Open full dashboard
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h7v7"/><path d="M13 3l-9 9"/></svg>
    </button>`;
}

/// "Today" / "Yesterday" / weekday name / fallback to YYYY-MM-DD.
/// Data dates are local to the user's machine (TokenBBQ writes them that way),
/// so we compare against `new Date()` without timezone gymnastics.
function formatRelativeDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return iso;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderError(message: string): void {
  document.getElementById("five-hour-compact")!.textContent = "—";
  document.getElementById("seven-day-compact")!.textContent = "err";
  // Errors here are claude.ai-specific; hide the local zone so we don't show
  // stale numbers next to a broken half.
  renderLocalCompact(null);

  document.getElementById("usage-bars")!.innerHTML = `
    <div class="error-banner">
      <span class="error-icon">&#x26A0;</span>
      <span>${escapeHtml(message)}</span>
    </div>`;
}

export async function setViewState(state: ViewState, mode: SourceMode = 'claude'): Promise<void> {
  const pill = document.getElementById("compact-view")!;
  const panel = document.getElementById("expanded-view")!;
  const settings = document.getElementById("settings-overlay")!;
  const win = getCurrentWindow();

  if (state === "compact") {
    settings.classList.remove("visible");
    panel.classList.remove("visible");
    pill.classList.remove("hidden-pill");
    pill.classList.toggle("dual-mode", mode === 'both');
    const sz = compactSizeForMode(mode);
    await win.setSize(new LogicalSize(sz.width, sz.height));
  } else if (state === "expanded") {
    settings.classList.remove("visible");
    pill.classList.add("hidden-pill");
    // Set an initial floor so the panel has space to lay out before we measure.
    // fitExpandedToContent then snaps the window to the actual content height.
    await win.setSize(new LogicalSize(EXPANDED_WIDTH, EXPANDED_INITIAL_HEIGHT));
    requestAnimationFrame(() => {
      panel.classList.add("visible");
      requestAnimationFrame(() => { void fitExpandedToContent(); });
    });
  } else if (state === "settings") {
    settings.classList.add("visible");
  }
}

/// Snap the host window to fit the expanded panel's actual content height,
/// clamped to [MIN, MAX]. Beyond MAX the panel scrolls instead. Called on
/// view transitions and after every renderExpanded so the window grows /
/// shrinks as data arrives (e.g. local AI tools section appearing late).
///
/// We measure titlebar + usage-body.scrollHeight rather than panel.scrollHeight
/// because the body has overflow:auto — when the window is currently smaller
/// than the content, the panel's own scrollHeight reports the truncated
/// (clipped) value, not what we'd need to fit everything.
export async function fitExpandedToContent(): Promise<void> {
  const panel = document.getElementById("expanded-view");
  if (!panel || !panel.classList.contains("visible")) return;
  const titlebar = panel.querySelector(".titlebar") as HTMLElement | null;
  const body = panel.querySelector(".usage-body") as HTMLElement | null;
  const titleH = titlebar?.offsetHeight ?? 0;
  const bodyH = body?.scrollHeight ?? panel.scrollHeight;
  // +8px absorbs sub-pixel rounding under fractional DPR and leaves a small
  // breathing margin under the last row so the panel doesn't end flush with
  // the window edge.
  const target = Math.min(EXPANDED_MAX_HEIGHT, Math.max(EXPANDED_MIN_HEIGHT, titleH + bodyH + 8));
  try {
    await getCurrentWindow().setSize(new LogicalSize(EXPANDED_WIDTH, target));
  } catch {
    // Window may have been hidden between rAF and resize; nothing useful to do.
  }
}
