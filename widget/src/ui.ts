import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import type { ClaudeUsageResponse, LocalUsageSummary, ViewState } from "./types";
import { resolveMode, type SourceMode, type SourceToggleState } from "./source-toggle";

const COMPACT_SIZE_SINGLE = { width: 320, height: 64 };
// Identical width to single — only the height grows for the second
// chip row. Pill 84 tall + 12 margin + 2 WebView2 buffer = 98.
const COMPACT_SIZE_DUAL = { width: 320, height: 98 };

function compactSizeForMode(mode: SourceMode): { width: number; height: number } {
  return mode === 'both' ? COMPACT_SIZE_DUAL : COMPACT_SIZE_SINGLE;
}
// Expanded panel widens beyond the pill so the side-by-side Claude/Codex
// rate-limit grid has breathing room (the pill stays narrow because it
// lives on screen all the time).
const EXPANDED_WIDTH = 440;
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

// Long-form reset labels for the expanded panel. "Resets in 2h 15m" or
// "Resets May 5". Empty string when no timestamp is available yet.
function formatTimeUntil(isoString: string | null): string {
  if (!isoString) return "";
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs <= 0) return "Resetting...";
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours >= 24) {
    return `Resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  }
  return `Resets in ${hours}h ${minutes}m`;
}

function formatResetDate(isoString: string | null): string {
  if (!isoString) return "";
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs < 86400000) return formatTimeUntil(isoString);
  return `Resets ${new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
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
// Claude: 8-petal radial burst (Anthropic's brand language — softer than a
// plain star, with rounded "tentacle" ends).
// Codex/OpenAI: simplified knot/loop motif (OpenAI's brand language).
// Simplified silhouettes, not pixel-exact replicas of the official marks.
// const claudeBadgeSvg = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g transform="translate(12 12)"><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8"/><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8" transform="rotate(45)"/><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8" transform="rotate(90)"/><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8" transform="rotate(135)"/><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8" transform="rotate(180)"/><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8" transform="rotate(225)"/><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8" transform="rotate(270)"/><ellipse cx="0" cy="-6.5" rx="1.7" ry="4.8" transform="rotate(315)"/></g></svg>`;
// const codexBadgeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="10.5" ry="4.7"/><ellipse cx="12" cy="12" rx="10.5" ry="4.7" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10.5" ry="4.7" transform="rotate(120 12 12)"/></svg>`;
const claudeBadgeSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" fill-rule="evenodd" clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"/></svg>`;
const codexBadgeSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.064 3.344a4.578 4.578 0 0 1 2.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 0 0 .043 0 4.55 4.55 0 0 1 3.046.275l.047.022.116.057a4.581 4.581 0 0 1 2.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 0 1-.134 1.223.123.123 0 0 0 .03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 0 1-2.201 1.388.123.123 0 0 0-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 0 0-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 0 1-1.945-.466 4.544 4.544 0 0 1-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 0 1-.37-.961 4.582 4.582 0 0 1-.014-2.298.124.124 0 0 0 .006-.056.085.085 0 0 0-.027-.048 4.467 4.467 0 0 1-1.034-1.651 3.896 3.896 0 0 1-.251-1.192 5.189 5.189 0 0 1 .141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 0 0 .065-.066 4.51 4.51 0 0 1 .829-1.615 4.535 4.535 0 0 1 1.837-1.388zm3.482 10.565a.637.637 0 0 0 0 1.272h3.636a.637.637 0 1 0 0-1.272h-3.636zM8.462 9.23a.637.637 0 0 0-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 1 0 1.095.649l1.454-2.455a.636.636 0 0 0 .005-.64L8.462 9.23z" fill="url(#codex-gradient)"/><defs><linearGradient id="codex-gradient" x1="12" x2="12" y1="3" y2="21" gradientUnits="userSpaceOnUse"><stop stop-color="#B1A7FF"/><stop offset=".5" stop-color="#7A9DFF"/><stop offset="1" stop-color="#3941FF"/></linearGradient></defs></svg>`;

const CLAUDE_BRAND_COLOR = '#c15f3c';
const CODEX_BRAND_COLOR = '#74aa9c';

const clockSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 8a6.5 6.5 0 1 1 1 3.5"/><path d="M1 5v3.5H4.5"/></svg>`;

// Single utilization row for the expanded panel: name + percent on top,
// progress bar below, "Resets in ..." line beneath. `resetText` is the
// already-formatted string (different windows want different formats).
//
// When `brandColor` is set the entire row (dot, percent, bar) renders in
// that brand color — used for the Claude / Codex rate-limit blocks where
// the bar fill width already conveys utilization, so we drop the
// green/orange/red tier signal in favor of brand identity. Without
// `brandColor` we fall back to the tier coloring (still used by Extra
// Usage and any other utilization row added later).
function usageRowHtml(
  name: string,
  pct: number,
  resetText: string,
  brandColor?: string,
): string {
  let color: string;
  let glow: string;
  let fillStyle: string;
  if (brandColor) {
    color = brandColor;
    // Soft halo around the dot + bar in the same hue. 33 = ~20% alpha.
    glow = `${brandColor}66`;
    fillStyle = `width:${pct}%;background:${brandColor};box-shadow:0 0 8px ${brandColor}55`;
  } else {
    const tier = colorTier(pct);
    color = `var(--${tier})`;
    glow = `var(--${tier}-glow)`;
    fillStyle = `width:${pct}%`;
  }
  const fillClass = brandColor ? 'progress-fill' : `progress-fill ${colorTier(pct)}`;
  return `
    <div class="usage-row">
      <div class="usage-row-header">
        <span class="usage-row-name"><span class="dot" style="background:${color};box-shadow:0 0 4px ${glow}"></span>${name}</span>
        <span class="usage-row-value">${Math.round(pct)}%</span>
      </div>
      <div class="progress-track"><div class="${fillClass}" style="${fillStyle}"></div></div>
      ${resetText ? `<div class="usage-row-meta"><span class="usage-row-reset">${clockSvg}${resetText}</span></div>` : ""}
    </div>`;
}

// Section-header with a small brand logo + colored title. Used to mark the
// Claude / Codex rate-limit sections so they visually pair with the toggle
// rows above (same logos, same brand colors).
function brandSectionHeaderHtml(label: string, logoSvg: string, color: string): string {
  return `
    <div class="section-header brand">
      <span class="section-header-title" style="color:${color}">
        <span class="section-header-logo">${logoSvg}</span>${label}
      </span>
    </div>`;
}

// Map a Codex window's length (minutes) to a human label parallel to the
// Claude side ("5-Hour Window" / "Weekly Window"). Falls back to a generic
// hour/day form for unusual window sizes.
function codexWindowLabel(windowMinutes: number): string {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return "Window";
  if (windowMinutes < 1440) {
    const hours = Math.round(windowMinutes / 60);
    return `${hours}-Hour Window`;
  }
  const days = Math.round(windowMinutes / 1440);
  if (days === 7) return "Weekly Window";
  return `${days}-Day Window`;
}

function toggleRowHtml(
  id: string,
  label: string,
  logoSvg: string,
  logoColor: string,
  checked: boolean,
  disabled: boolean,
  hint?: string,
): string {
  return `
    <div class="source-toggle-row${disabled ? ' disabled' : ''}">
      <span class="source-toggle-logo" style="color:${logoColor}">${logoSvg}</span>
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

  const primaryLogo = document.getElementById('pill-row-logo-primary')!;
  const secondaryLogo = document.getElementById('pill-row-logo-secondary')!;

  // Toggle the empty-state class up front. CSS handles the styling
  // (centered dash, hidden label, muted color) so we don't have to
  // reach for these visual details in every branch below.
  document.getElementById('compact-view')!.classList.toggle('pill-empty', mode === 'none');

  if (mode === 'none') {
    // User has both Claude and Codex toggled off. Show two empty boxes
    // with a centered minus — no fallback numbers, no labels.
    setSingleRowVisibility();
    fiveHour.textContent = '−'; // U+2212 MINUS SIGN
    fiveHour.style.color = '';
    sevenDay.textContent = '−';
    sevenDay.style.color = '';
    fiveHourLabel.textContent = '';
    sevenDayLabel.textContent = '';
    return;
  }

  // Helper: reset to single-row layout (hide secondary row + both row logos).
  // In single-mode the standalone .pill-fire on the left identifies the source.
  // In dual-mode the flame is hidden via CSS and each row carries its own brand
  // logo so users can tell Claude (top) from Codex (bottom) at a glance.
  function setSingleRowVisibility(): void {
    document.getElementById('pill-row-secondary')!.setAttribute('hidden', '');
    primaryLogo.setAttribute('hidden', '');
    primaryLogo.innerHTML = '';
    secondaryLogo.setAttribute('hidden', '');
    secondaryLogo.innerHTML = '';
  }

  if (mode === 'both' && codex) {
    // Dual-mode: show both rows AND their brand logos. CSS hides the
    // standalone .pill-fire in this mode, so the row logos are the only
    // brand identifier visible.
    document.getElementById('pill-row-secondary')!.removeAttribute('hidden');
    primaryLogo.innerHTML = claudeBadgeSvg;
    primaryLogo.style.color = CLAUDE_BRAND_COLOR;
    primaryLogo.removeAttribute('hidden');
    secondaryLogo.innerHTML = codexBadgeSvg;
    secondaryLogo.style.color = CODEX_BRAND_COLOR;
    secondaryLogo.removeAttribute('hidden');

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
  const today = document.getElementById("today-compact")! as HTMLElement;

  if (!local) {
    divider.hidden = true;
    local_zone.hidden = true;
    return;
  }

  divider.hidden = false;
  local_zone.hidden = false;
  today.textContent = formatTokens(local.todayTokens);

  // Tint the today value with the brand color of whichever local AI tool
  // contributed the most tokens today — gives an at-a-glance read of the
  // dominant source. Falls back to the CSS default (--accent) when there's
  // no per-source breakdown yet.
  if (local.todayBySource.length > 0) {
    const top = local.todayBySource.reduce((a, b) => (b.tokens > a.tokens ? b : a));
    today.style.color = sourceColor(top.source);
  } else {
    today.style.color = '';
  }
}

// Claude rate-limit block: header + 5h + 7d windows. Returns an empty
// string when no rate-limit data is present so callers can decide whether
// to render at all. Used both stand-alone (full-width) and inside the
// two-column grid.
function renderClaudeRatesHtml(usage: ClaudeUsageResponse): string {
  if (!usage.five_hour && !usage.seven_day) return '';
  let out = brandSectionHeaderHtml('Claude Code', claudeBadgeSvg, CLAUDE_BRAND_COLOR);
  if (usage.five_hour) {
    out += usageRowHtml(
      '5-Hour Window',
      usage.five_hour.utilization,
      formatTimeUntil(usage.five_hour.resets_at),
      CLAUDE_BRAND_COLOR,
    );
  }
  if (usage.seven_day) {
    out += usageRowHtml(
      'Weekly Window',
      usage.seven_day.utilization,
      formatResetDate(usage.seven_day.resets_at),
      CLAUDE_BRAND_COLOR,
    );
  }
  return out;
}

// Codex rate-limit block: parallel structure to the Claude block above. The
// caller already gates on plan availability — this function trusts that and
// just renders whatever windows exist.
function renderCodexRatesHtml(codex: NonNullable<LocalUsageSummary['codexUsage']>): string {
  if (!codex.primary && !codex.secondary) return '';
  let out = brandSectionHeaderHtml('Codex', codexBadgeSvg, CODEX_BRAND_COLOR);
  if (codex.primary) {
    out += usageRowHtml(
      codexWindowLabel(codex.primary.windowMinutes),
      codex.primary.utilization,
      formatTimeUntil(codex.primary.resetsAt),
      CODEX_BRAND_COLOR,
    );
  }
  if (codex.secondary) {
    out += usageRowHtml(
      codexWindowLabel(codex.secondary.windowMinutes),
      codex.secondary.utilization,
      formatResetDate(codex.secondary.resetsAt),
      CODEX_BRAND_COLOR,
    );
  }
  return out;
}

export function renderExpanded(
  usage: ClaudeUsageResponse,
  local: LocalUsageSummary | null = null,
  toggleState: SourceToggleState = { claude: true, codex: false },
): void {
  const container = document.getElementById("usage-bars")!;
  const panel = document.getElementById("expanded-view")!;
  const isLiveRefresh = panel.classList.contains("visible") && container.childElementCount > 0;

  const codex = local?.codexUsage ?? null;
  const codexAvailable = codex !== null && codex.planType !== null;
  const codexHint = codex === null
    ? '(no data)'
    : (codex.planType === null ? '(API key — no plan)' : '');

  let html = `<div class="section-header">Pill displays</div>`;
  html += `<div class="source-toggle-list">`;
  html += toggleRowHtml('toggle-claude', 'Claude Code', claudeBadgeSvg, CLAUDE_BRAND_COLOR, toggleState.claude, false);
  html += toggleRowHtml('toggle-codex', 'Codex', codexBadgeSvg, CODEX_BRAND_COLOR, toggleState.codex && codexAvailable, !codexAvailable, codexHint);
  html += `</div>`;

  // Claude + Codex rate-limit blocks. Side-by-side when both have data;
  // single full-width column when only one is present. Hidden completely
  // when neither has data.
  const claudeBlock = renderClaudeRatesHtml(usage);
  const codexBlock = codexAvailable && codex ? renderCodexRatesHtml(codex) : '';

  if (claudeBlock && codexBlock) {
    html += `
      <div class="brand-rates-grid">
        <div class="brand-rates-col">${claudeBlock}</div>
        <div class="brand-rates-divider"></div>
        <div class="brand-rates-col">${codexBlock}</div>
      </div>`;
  } else if (claudeBlock) {
    html += claudeBlock;
  } else if (codexBlock) {
    html += codexBlock;
  }

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

  container.classList.toggle("animate-rows", !isLiveRefresh);
  container.classList.toggle("silent-refresh", isLiveRefresh);
  container.innerHTML = html;

  // Intentionally do NOT auto-resize the window when new data arrives while
  // the panel is open. Two reasons:
  //  1. setPosition would yank the window back to the captured pill anchor
  //     every poll, even if the user has it placed comfortably — that's
  //     extremely user-hostile.
  //  2. Any size feedback loop (e.g. a flex:1 body whose scrollHeight tracks
  //     the window) would silently grow the window until it hits MAX_HEIGHT.
  // The window is sized exactly once on expand (via measureExpandedHeight)
  // and stays that size. If content outgrows it, the body's overflow-y:auto
  // takes over and scrolls inside the fixed window.
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
    <div class="local-header-block">
      <div class="local-header-row local-header-row-today">
        <span class="local-header-label">${escapeHtml(dateLabel)}</span>
        <span class="local-header-today">${formatTokens(local.todayTokens)}<span class="local-header-unit"> tok</span></span>
      </div>
      <div class="local-header-row local-header-row-week">
        <span class="local-header-label">7d</span>
        <span class="local-header-week">${formatTokens(local.weekTokens)}</span>
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

// pillPosition is the pill's "home" — the visible top-left of the compact
// pill in physical px. Stored in *visible* coordinates (not tauri-window
// coordinates) so it's mode-independent: pill has a 6-px CSS margin while
// panel uses inset:0, so the same tauri-x means different visible-x in the
// two modes; storing the visible-x sidesteps that mismatch.
//
// Updated only when in PILL mode (pill drag-end, or first capture). Panel
// drags deliberately do NOT update — the pill's home stays put while the
// user moves the panel around, so collapsing always returns to the same
// pill spot.
interface PillPosition {
  visibleX: number;  // physical px
  visibleY: number;
}
let pillPosition: PillPosition | null = null;

// Read the current pill's visible top-left. Caller must be in pill mode
// (i.e. compact-view does NOT have hidden-pill); we don't double-check
// because every call site is gated.
async function captureCurrentPillPosition(): Promise<void> {
  try {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const scale = await win.scaleFactor();
    const insetPhys = Math.round(PILL_FRAME_INSET_LOGICAL * scale);
    pillPosition = {
      visibleX: pos.x + insetPhys,
      visibleY: pos.y + insetPhys,
    };
  } catch (e) {
    console.warn('captureCurrentPillPosition failed:', e);
  }
}

// Hook for main.ts: refresh pillPosition after a drag-end, but only if
// currently in pill mode. Panel drags are no-ops here.
export async function refreshPillPositionIfPillMode(): Promise<void> {
  if (currentFrameInsetLogical() === PILL_FRAME_INSET_LOGICAL) {
    await captureCurrentPillPosition();
  }
}

// Position the panel so its visible top-left equals pillPosition. Panel
// grows down-right naturally; if it would overflow the work area, the
// clamp shifts it up-left so it stays fully visible. Anchor is top-left,
// not bottom-right, so the user perceives the panel as "opening downward
// from the pill" the way a normal Windows app does.
async function positionPanelAtPill(): Promise<void> {
  if (!pillPosition) return;
  try {
    const win = getCurrentWindow();
    const size = await win.outerSize();
    // Panel's CSS inset is 0, so panel tauri-x equals visible-x.
    let targetX = pillPosition.visibleX;
    let targetY = pillPosition.visibleY;
    const work = getWorkAreaPhysical(0);
    if (work) {
      targetX = Math.max(work.minX, Math.min(targetX, work.maxX - size.width));
      targetY = Math.max(work.minY, Math.min(targetY, work.maxY - size.height));
    }
    await win.setPosition(new PhysicalPosition(targetX, targetY));
  } catch (e) {
    console.warn('positionPanelAtPill failed:', e);
  }
}

// Restore the pill to its home. Pill's CSS inset is 6, so tauri-x =
// visible-x - 6 (logical, scaled to physical).
async function restorePillToHome(): Promise<void> {
  if (!pillPosition) return;
  try {
    const win = getCurrentWindow();
    const size = await win.outerSize();
    const scale = await win.scaleFactor();
    const insetPhys = Math.round(PILL_FRAME_INSET_LOGICAL * scale);
    let targetX = pillPosition.visibleX - insetPhys;
    let targetY = pillPosition.visibleY - insetPhys;
    const work = getWorkAreaPhysical(PILL_FRAME_INSET_LOGICAL);
    if (work) {
      targetX = Math.max(work.minX, Math.min(targetX, work.maxX - size.width));
      targetY = Math.max(work.minY, Math.min(targetY, work.maxY - size.height));
    }
    await win.setPosition(new PhysicalPosition(targetX, targetY));
  } catch (e) {
    console.warn('restorePillToHome failed:', e);
  }
}

// Physical-px breathing room kept between the *visible element* and every
// work-area edge. This intentionally does not scale with Windows DPI:
// "8 px from the wall" should look like 8 actual screen pixels, not
// 10-12 px on 125-150% scaling.
const EDGE_MARGIN_PHYSICAL = 8;

// Compact pill has a 6-px outer margin in CSS (`.pill { margin: 6px }`)
// to give the hover glow room before WebView2's overflow:hidden clips it.
// Expanded panel uses `inset: 0` and fills its window edge-to-edge. The
// Tauri window itself is the same in both modes, so when we clamp the
// window position with EDGE_MARGIN we end up with a visible pill that
// sits 6 px farther from the screen edge than the visible panel.
// Callers compensate by passing this inset to getWorkAreaPhysical when
// the active view is the compact pill.
export const PILL_FRAME_INSET_LOGICAL = 6;

// Returns true when the compact pill (not the expanded panel) is the
// currently visible surface. The .hidden-pill class is added in
// setViewState whenever we transition to the expanded/settings view, so
// its absence means the pill is the visible element.
export function currentFrameInsetLogical(): number {
  const compact = document.getElementById('compact-view');
  if (compact && !compact.classList.contains('hidden-pill')) {
    return PILL_FRAME_INSET_LOGICAL;
  }
  return 0;
}

type WorkAreaPhysical = { minX: number; minY: number; maxX: number; maxY: number };
let monitorWorkAreaPhysical: WorkAreaPhysical | null = null;

export function setMonitorWorkAreaPhysical(workArea: WorkAreaPhysical | null): void {
  monitorWorkAreaPhysical = workArea;
}

// Work-area bounds in physical pixels: the screen area NOT covered by the
// Windows taskbar, inset by (EDGE_MARGIN_PHYSICAL - frameInsetPhysical) on
// every side. Prefer the Tauri monitor union so dragging can cross monitors;
// fall back to Chromium's current-screen work area if the monitor API is not
// available yet during early startup.
export function getWorkAreaPhysical(
  frameInsetLogical = 0,
): WorkAreaPhysical | null {
  const dpr = window.devicePixelRatio;
  if (!dpr || !Number.isFinite(dpr)) return null;
  const frameInsetPhysical = Math.round(frameInsetLogical * dpr);
  const margin = Math.max(0, EDGE_MARGIN_PHYSICAL - frameInsetPhysical);
  if (monitorWorkAreaPhysical) {
    return {
      minX: monitorWorkAreaPhysical.minX + margin,
      minY: monitorWorkAreaPhysical.minY + margin,
      maxX: monitorWorkAreaPhysical.maxX - margin,
      maxY: monitorWorkAreaPhysical.maxY - margin,
    };
  }
  // availLeft / availTop are non-standard but supported in Chromium-based
  // WebView2; TS's lib.dom doesn't declare them, hence the cast.
  const screenAny = window.screen as unknown as { availLeft?: number; availTop?: number };
  const left = (screenAny.availLeft ?? 0) * dpr;
  const top = (screenAny.availTop ?? 0) * dpr;
  const width = window.screen.availWidth * dpr;
  const height = window.screen.availHeight * dpr;
  return {
    minX: Math.round(left) + margin,
    minY: Math.round(top) + margin,
    maxX: Math.round(left + width) - margin,
    maxY: Math.round(top + height) - margin,
  };
}

// (Old positionExpandedWindow / pillAnchor removed — replaced by the
// captureVisibleAnchor / applyVisibleAnchor pair above, which is mode-aware
// and handles both expand and collapse transitions consistently.)

// Measure how tall the expanded panel needs to be at EXPANDED_WIDTH, *without*
// resizing the actual window. We clone the live panel into an off-screen
// container at the target width, force a layout pass, read titlebar height +
// usage-body scrollHeight, then dispose. The clone inherits the user's
// rendered content, so the measurement reflects whatever data is currently
// shown — no special seeding needed.
//
// This is the secret sauce that makes the expand transition smooth: instead
// of resizing twice (initial floor → final content fit, with a visible jump
// in between), we resize ONCE to the right height before revealing the
// panel.
// Measure how tall the expanded panel needs to be at EXPANDED_WIDTH without
// touching the live window. We build a minimal off-screen measurement
// container at the target width that mirrors the live structure (titlebar
// + usage-body content) but with NO flex / NO overflow constraints, so
// children stack to their natural sizes. The result is the exact height
// needed to display all content without scrolling.
//
// Why not clone the whole .panel element: the panel's own CSS uses
// `position: absolute; inset: 0; display: flex; flex-direction: column`
// plus a `flex: 1` body. Cloning that into an auto-sized container creates
// phantom height (flex:1 children behave oddly without a sized parent) and
// settings-overlay's `inset: 0` muddies the measurement. Building from
// scratch is simpler and predictable.
function measureExpandedHeight(panel: HTMLElement, targetWidth: number): number {
  const titlebar = panel.querySelector('.titlebar') as HTMLElement | null;
  const body = panel.querySelector('.usage-body') as HTMLElement | null;
  if (!titlebar || !body) return EXPANDED_MIN_HEIGHT;

  const measure = document.createElement('div');
  measure.style.cssText = [
    'position: absolute',
    'top: -10000px',
    'left: 0',
    `width: ${targetWidth}px`,
    'visibility: hidden',
    'pointer-events: none',
    'border: 1px solid transparent', // matches .panel's 1px border so width math is identical
    'border-radius: 16px',
  ].join(';');

  // Clone the titlebar — it carries its own CSS classes, layout is identical.
  const titlebarClone = titlebar.cloneNode(true) as HTMLElement;
  measure.appendChild(titlebarClone);

  // Recreate the usage-body but force natural-flow layout so children stack
  // to their real heights instead of fighting flex:1.
  const bodyMeasure = document.createElement('div');
  bodyMeasure.className = 'usage-body';
  bodyMeasure.style.cssText = 'flex: 0 0 auto; overflow: visible; height: auto; max-height: none';
  bodyMeasure.innerHTML = body.innerHTML;
  measure.appendChild(bodyMeasure);

  document.body.appendChild(measure);
  void measure.offsetHeight; // force synchronous layout
  const total = measure.offsetHeight;
  document.body.removeChild(measure);

  return Math.min(EXPANDED_MAX_HEIGHT, Math.max(EXPANDED_MIN_HEIGHT, total));
}

export async function setViewState(state: ViewState, mode: SourceMode = 'claude'): Promise<void> {
  const pill = document.getElementById("compact-view")!;
  const panel = document.getElementById("expanded-view")!;
  const settings = document.getElementById("settings-overlay")!;
  const win = getCurrentWindow();

  if (state === "compact") {
    // Restore the pill to its home. Note we deliberately do NOT capture
    // the current panel position — the pill's home is a separate concept
    // that only updates from pill drags, so the user can move the panel
    // around mid-expand and the pill still returns to where it was.
    document.body.classList.remove("view-transitioning");
    settings.classList.remove("visible");
    panel.classList.remove("visible");
    pill.classList.remove("hidden-pill");
    pill.classList.toggle("dual-mode", mode === 'both');
    const sz = compactSizeForMode(mode);
    await win.setSize(new LogicalSize(sz.width, sz.height));
    await restorePillToHome();
  } else if (state === "expanded") {
    // Capture the pill's home on first expand. Subsequent expands (after
    // the pill has been dragged) keep the position fresh via main.ts's
    // drag-end hook (refreshPillPositionIfPillMode).
    if (!pillPosition) await captureCurrentPillPosition();
    settings.classList.remove("visible");
    panel.classList.remove("visible");
    document.body.classList.add("view-transitioning");
    // Pre-measure the panel content at the target width using an off-screen
    // clone, so we can resize the window once to its final size instead of
    // doing a two-stage initial-then-fit dance that the user perceives as
    // jitter.
    const targetH = measureExpandedHeight(panel, EXPANDED_WIDTH);
    await win.setSize(new LogicalSize(EXPANDED_WIDTH, targetH));
    await positionPanelAtPill();
    // Window is now at final size + position. Swap pill -> panel in the next
    // paint so the user never sees an empty resized body between states.
    requestAnimationFrame(() => {
      pill.classList.add("hidden-pill");
      panel.classList.add("visible");
      document.body.classList.remove("view-transitioning");
    });
  } else if (state === "settings") {
    document.body.classList.remove("view-transitioning");
    settings.classList.add("visible");
  }
}

// One-shot work-area clamp at startup: if a previously-saved pill position
// is now outside the work area (e.g. the user changed their taskbar height
// or display setup since last run), nudge the window back inside. The
// regular drag is clamped inline in setupDragRegions (JS drag), so we
// don't need a continuous listener fighting Windows' move events.
export async function clampWindowToWorkAreaOnce(): Promise<void> {
  try {
    const win = getCurrentWindow();
    // Startup is always compact-mode, so use the pill's frame inset so
    // the visible pill ends up exactly EDGE_MARGIN_PHYSICAL from the edge.
    const work = getWorkAreaPhysical(currentFrameInsetLogical());
    if (!work) return;
    const pos = await win.outerPosition();
    const size = await win.outerSize();
    const maxX = work.maxX - size.width;
    const maxY = work.maxY - size.height;
    const clampedX = Math.max(work.minX, Math.min(pos.x, maxX));
    const clampedY = Math.max(work.minY, Math.min(pos.y, maxY));
    if (clampedX !== pos.x || clampedY !== pos.y) {
      await win.setPosition(new PhysicalPosition(clampedX, clampedY));
    }
  } catch (e) {
    console.warn('startup work-area clamp failed:', e);
  }
}

