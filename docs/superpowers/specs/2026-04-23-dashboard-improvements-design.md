# Dashboard Improvements — Design

**Date:** 2026-04-23
**Scope:** `src/dashboard.ts` (single-file dashboard)
**Status:** Design approved, pending user review

## Context

TokenBBQ visualises AI coding tool token usage in a browser dashboard. The main page feels polished (warm brand palette, well-spaced cards, working interactions), but two areas break the experience:

1. Cost is over-emphasised versus tokens, even though "tokens" is the subject of the tool.
2. The click-through popups ("Daily Usage Patterns", "Monthly Analysis") feel like a different app — generic Tailwind accent colors, minimal charts, unreadable raw numbers.

This spec covers a focused visual and conceptual pass on those two areas plus app-wide number formatting. Loaders, aggregation, CLI, and the heatmap/source/model popups are out of scope.

## Decisions (locked)

### Track 1 — Main dashboard surface

**Header KPI order** changes from `Total Cost · Total Tokens · Active Days · Cost/Day · Top Model` to:

```
Total Tokens · Total Cost · Cost/Day · Active Days · Top Model
```

Rationale: tokens are the subject; cost is context.

**Chart data: switch three charts from cost to tokens.**

| Chart | Old title / data | New title / data |
|---|---|---|
| Donut (`chart-source`) | "Cost by Provider" — `costUSD` per source | **"Tokens by Provider"** — total tokens per source |
| Horizontal bars (`chart-model`) | "Top Models by Cost" — `costUSD` per model | **"Top Models by Tokens"** — total tokens per model |
| Line (`chart-monthly`) | "Monthly Trend" — `costUSD` per month, label `"Cost (USD)"` | **"Monthly Trend"** — total tokens per month, label `"Tokens"` |

Donut shape, bar orientation, and line chart type stay the same. Only the data and titles change.

**Cost information retained** only in:
- `Total Cost` KPI card (header)
- `Cost / Day` KPI card (header)
- `Daily Breakdown` table at the bottom (column "Cost")

### Track 2 — App-wide formatting rules

#### Number formatting

Applies everywhere: KPI cards, chart axes, tooltips, popup stats, detail tables. Explicit exception: the `Daily Breakdown` table keeps exact values (users expect exact numbers in that table).

| Type | Range | Rule | Example |
|---|---|---|---|
| Tokens | ≥ 1,000,000,000 | 1 decimal + `B` | `1,596,587,372` → `1.6B` |
| Tokens | ≥ 1,000,000 | 1 decimal + `M` | `106,924,680` → `106.9M` |
| Tokens | ≥ 1,000 | 1 decimal + `K` | `24,815` → `24.8K` |
| Tokens | < 1,000 | full number with thousands separator | `152` → `152` |
| USD | any | always 2 decimals, never abbreviated | `$3071.58`, `$48.89`, `$0.54` |
| Percent | any | 1 decimal | `207.7%` |

A new helper `fmtTokens(n)` is added alongside the existing `fmt` and `fmtUSD`. Call sites that display token counts switch from `fmt(...)` to `fmtTokens(...)`. `fmt` remains for non-token numbers (counts, day counts, event counts) that should stay literal. `fmtUSD` stays as it is.

#### Color rules

Popup accent colors switch from generic Tailwind accents to the brand palette.

| Purpose | Before | After |
|---|---|---|
| Primary accent | `#60a5fa` (blue) / `#a78bfa` (violet) / `#a855f7` (purple) — mixed | `#E87B35` (brand orange, already used in main Monthly Trend line) |
| Per-source tint | ad-hoc | `SOURCE_COLORS[source]` (already defined in `types.ts`) |
| Trend up (bad for cost, good for tokens) | `#f87171` (harsh red) | `#dc6b5c` (muted terracotta-red, warmer) |
| Trend down (good for cost) | `#4ade80` (bright green) | `#74aa9c` (Codex sage — matches palette) |
| Progress bars, generic fills | mixed blue/violet/red | single brand orange `#E87B35` |

No more `#60a5fa`, `#a78bfa`, `#a855f7`, `#f87171`, `#4ade80` in popup code paths. Existing usages in non-popup code (e.g., heatmap greens) are out of scope.

### Track 3 — Popup rebuilds

Both popups get a proper hero chart as the first visual element. Stat cards and supporting sections stay but re-color to brand palette.

#### Daily Usage Patterns popup (`buildDailyChartPopup`)

**Hero chart:** Area chart with orange gradient fill.
- Height ~220px (currently ~60px sparkline).
- Single series: total tokens per day across all sources.
- Smooth line (`tension: 0.3`), fill from line down to x-axis with gradient from `#E87B35` at top to transparent at bottom.
- Y-axis with `fmtTokens` ticks (`500M`, `250M`, …).
- X-axis with reduced tick count (max 8) showing dates.
- Hover tooltip: `<date> · <fmtTokens(n)> tokens`.
- Built with Chart.js (already a dependency), animations re-enabled for this chart only.

**Stat cards:** "Avg Daily Tokens" and "Busiest Week" keep their purpose. Accent colors change from `#a78bfa` / `#f87171` to `#E87B35` and `SOURCE_COLORS['claude-code']` (terracotta).

**Day-of-week bars:** Keep structure. Bar fill color changes from `#60a5fa` to `#E87B35`. Labels use `fmtTokens`.

#### Monthly Analysis popup (`buildMonthlyChartPopup`)

**Hero chart:** Thick vertical bars, one per month.
- Height ~240px.
- One bar per month in `data.monthly`, full-width across popup width (gap ~10% of bar width).
- Bar fill: `#E87B35` (brand orange). Rounded top corners.
- Above each bar: token total in `fmtTokens` (e.g., `1.6B`).
- Below each bar: month label (`2026-04`) and MoM change badge (`↑ 207.7%` in trend-up color, `↓ 12.4%` in trend-down color).
- Hover: slight fill lightening, tooltip with exact token count (`fmtTokens`) and exact cost (`fmtUSD`).
- Renders meaningfully with ≥ 1 data point (unlike the current sparkline which needs > 2).

**Stat cards:** Switch from cost-based to token-based, per Track 1 rule (cost only in header).
- "Avg Monthly Cost" → **"Avg Monthly Tokens"** (value: `fmtTokens(totalTokens / months.length)`, accent `#E87B35`).
- "Peak Month" (currently cost-based) → **"Peak Month"** keyed on tokens (value: `fmtTokens(peak.tokens)`, subtitle: `peak.month`, accent `SOURCE_COLORS['claude-code']`).

**Month-over-month list:** Keep the per-month row list below the hero chart for textual detail. Bar fill switches from `#a855f7` to `#E87B35`. Change arrows re-color per the Trend-up/down rules above. Values switch from `fmtUSD` to `fmtTokens`.

## Architecture

All changes are isolated to `src/dashboard.ts`. No file split or library change.

**New symbols:**
- `fmtTokens(n: number): string` — defined near `fmt`/`fmtUSD` (around line 363).
- `BRAND_COLORS` constant (object) holding `{ primary: '#E87B35', trendUp: '#dc6b5c', trendDown: '#74aa9c' }` — defined near `SOURCE_COLORS` import at top of the rendered script.

**Modified functions:**
- `renderSourceChart(data)` — switch data source from `s.costUSD` to `totalTokenCount(s.tokens)`; change tooltip label callback to use `fmtTokens`.
- `renderModelChart(data)` — switch from `m.costUSD` to `totalTokenCount(m.tokens)`; switch tooltip + axis callbacks to `fmtTokens`; re-sort by tokens.
- `renderMonthlyChart(data)` — switch from `m.costUSD` to `totalTokenCount(m.tokens)`; change dataset label from `"Cost (USD)"` to `"Tokens"`.
- `buildDailyChartPopup(data)` — replace sparkline block with full Area chart rendered into a canvas inside the popup body (new Chart.js instance on popup open, destroyed on popup close).
- `buildMonthlyChartPopup(data)` — replace sparkline + bar-row list with new hero thick-bars chart rendered into a canvas; keep the row list below but re-style.
- KPI HTML block (lines 244–263) — reorder cards to Tokens · Cost · Cost/Day · Active Days · Top Model.
- HTML titles (lines 274, 282) — "Cost by Provider" → "Tokens by Provider", "Top Models by Cost" → "Top Models by Tokens".

**Popup chart lifecycle:** `showPopup` currently destroys and rebuilds popup content on every open. The new Chart.js instances created in `buildDailyChartPopup` / `buildMonthlyChartPopup` must be destroyed when the popup closes to avoid leaking canvases. Store instances on `window.__popupChart` and destroy on close handler in `showPopup`.

## Non-goals

- No switch to a different chart library (Chart.js v4 stays).
- No changes to loaders, aggregator, pricing, CLI, or server.
- No changes to the other popups (Cost Analysis, Token Breakdown, Activity Analysis, Spending Patterns, Model Rankings, Provider Deep Dive, Activity Calendar, All Models).
- No changes to the heatmap, light-mode styles, or theme toggle.
- No change to the Daily Breakdown table's exact number formatting.

## Testing

Manual verification in browser:

1. Main page: KPI cards in the new order; donut, models bar, monthly line show token values with correctly abbreviated axes/tooltips.
2. Click "Daily Token Usage" card: hero Area chart in orange with gradient fill, axis labels like `500M`; stat cards and day-of-week bars in brand colors; all numbers `fmtTokens`-formatted.
3. Click "Monthly Trend" card: hero thick-bars chart with one bar per month, token labels above bars, MoM badges below; stat cards show token values; row list below in brand orange.
4. Theme toggle still works; no console errors; no visual regression on the Daily Breakdown table.
5. Memory: open and close each popup 10× in a row; DevTools Performance shows no canvas/chart leak.
