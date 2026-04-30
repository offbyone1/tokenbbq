# Codex Rate Limits + Pill Source Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Codex rate limits from local JSONL sessions, expose them through the sidecar to the widget, and replace the expanded panel's "Claude.ai Subscription" section with two source toggles (Claude Code / Codex) that drive what the compact pill displays — single-mode keeps current layout, dual-mode shows two stacked rows with brand logos.

**Architecture:** Codex CLI writes `rate_limits` snapshots to `~/.codex/sessions/**/rollout-*.jsonl` on every API exchange. A new loader function `loadCodexRateLimits()` reads the latest entry from the most recently modified session, normalizes it to match the existing Claude `WindowUsage` shape (Unix-seconds → ISO string, `used_percent` → `utilization`), and surfaces it through `DashboardData.codexRateLimits`. The sidecar JSON is consumed by the widget's existing `fetch_local_usage` Tauri command, which projects the new field into `LocalUsageSummary.codexUsage`. The widget UI is restructured to support per-source toggles: `localStorage` keeps user preference, `renderCompact()` becomes mode-aware (`single-claude`/`single-codex`/`dual`), and the pill window resizes dynamically.

**Tech Stack:** TypeScript (sidecar + widget), Rust (Tauri commands + serde DTOs), CSS (pill layout), vitest (sidecar tests). No new dependencies.

---

## Setup

- [ ] **S0.1: Verify clean working tree, create feature branch**

Run:
```bash
git status
git checkout master
git pull
git checkout -b feat/codex-rate-limits-pill-toggle
```

Expected: clean status, then on new branch.

- [ ] **S0.2: Capture a real fixture for tests**

Copy one current Codex JSONL line containing `rate_limits` to a fixture:
```bash
mkdir -p src/loaders/__fixtures__
LATEST=$(find ~/.codex/sessions -name "*.jsonl" -printf "%T@ %p\n" 2>/dev/null | sort -nr | head -1 | awk '{print $2}')
grep '"rate_limits"' "$LATEST" | tail -1 > src/loaders/__fixtures__/codex-rate-limits-sample.jsonl
```
Expected: file exists with one JSON line. Inspect that the line has the structure `{ "type": "event_msg", "payload": { "type": "token_count", "rate_limits": { "primary": {...}, "secondary": {...}, "plan_type": "plus", ... } } }`.

This file is committed so tests run deterministically.

---

## Phase 1 — Backend: Codex Rate Limit Extraction

### Task 1: Type definitions + loader function

**Files:**
- Modify: `src/types.ts`
- Modify: `src/loaders/codex.ts`
- Create: `src/loaders/codex.test.ts`

- [ ] **Step 1.1: Add `CodexRateLimits` types to `src/types.ts`**

Append at the end of the file (after `SOURCE_COLORS`):

```typescript
/// Snapshot of Codex CLI rate-limit state read from the most recent
/// session JSONL. Codex emits this structure on every `token_count`
/// event; we keep only the latest one. Unix-seconds reset times are
/// converted to ISO strings at extraction time so consumers can use the
/// same Date(...) parsing as Claude's WindowUsage.
export interface CodexWindowUsage {
	/// 0-100, matches Claude's WindowUsage.utilization semantics.
	utilization: number;
	/// Window length in minutes (300 for 5h, 10080 for 7d).
	windowMinutes: number;
	/// ISO 8601 timestamp; null only if Codex emitted a malformed entry.
	resetsAt: string | null;
}

export interface CodexRateLimits {
	/// "plus" / "pro" / "team" / "enterprise" / "edu". Null when the
	/// user authenticates via OPENAI_API_KEY (pay-as-you-go has no plan
	/// limits — UI should treat null as "Codex toggle unavailable").
	planType: string | null;
	/// 5-hour rolling window. Null only if missing in the source event.
	primary: CodexWindowUsage | null;
	/// 7-day rolling window. Null only if missing in the source event.
	secondary: CodexWindowUsage | null;
	/// ISO timestamp of the source `token_count` event — i.e. the
	/// moment of the user's last Codex API call. The widget renders
	/// these numbers without an "as of" stamp by user request, but we
	/// expose this for future use / debugging.
	snapshotAt: string;
}
```

- [ ] **Step 1.2: Write failing tests for `loadCodexRateLimits`**

Create `src/loaders/codex.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCodexRateLimits } from './codex.js';

function makeSession(dir: string, name: string, lines: string[], mtimeSec?: number): string {
	const file = path.join(dir, name);
	writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
	if (mtimeSec !== undefined) {
		utimesSync(file, mtimeSec, mtimeSec);
	}
	return file;
}

describe('loadCodexRateLimits', () => {
	let tmpHome: string;
	const ORIG_HOME = process.env.CODEX_HOME;

	beforeAll(() => {
		tmpHome = mkdtempSync(path.join(tmpdir(), 'codex-test-'));
		mkdirSync(path.join(tmpHome, 'sessions', '2026', '04', '30'), { recursive: true });
		process.env.CODEX_HOME = tmpHome;
	});

	afterAll(() => {
		if (ORIG_HOME === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = ORIG_HOME;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	it('returns null when no sessions exist', async () => {
		const result = await loadCodexRateLimits();
		expect(result).toBeNull();
	});

	it('extracts the latest rate_limits entry from the most recent session', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		const event = (usedPrimary: number, ts: string) => JSON.stringify({
			timestamp: ts,
			type: 'event_msg',
			payload: {
				type: 'token_count',
				info: null,
				rate_limits: {
					limit_id: 'codex',
					limit_name: null,
					primary: { used_percent: usedPrimary, window_minutes: 300, resets_at: 1777521443 },
					secondary: { used_percent: 8.0, window_minutes: 10080, resets_at: 1778051858 },
					credits: null,
					plan_type: 'plus',
					rate_limit_reached_type: null,
				},
			},
		});

		// Older session — should be ignored
		makeSession(dir, 'rollout-old.jsonl', [event(5.0, '2026-04-30T01:00:00.000Z')], 1000);
		// Newer session — within it, last rate_limits entry wins
		makeSession(dir, 'rollout-new.jsonl', [
			event(20.0, '2026-04-30T01:30:00.000Z'),
			event(38.0, '2026-04-30T01:40:00.000Z'),
		], 2000);

		const result = await loadCodexRateLimits();
		expect(result).not.toBeNull();
		expect(result!.planType).toBe('plus');
		expect(result!.primary).not.toBeNull();
		expect(result!.primary!.utilization).toBe(38.0);
		expect(result!.primary!.windowMinutes).toBe(300);
		expect(result!.primary!.resetsAt).toBe(new Date(1777521443 * 1000).toISOString());
		expect(result!.secondary!.utilization).toBe(8.0);
		expect(result!.snapshotAt).toBe('2026-04-30T01:40:00.000Z');
	});

	it('handles missing rate_limits gracefully', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		makeSession(dir, 'rollout-empty.jsonl', [
			JSON.stringify({ timestamp: '2026-04-30T02:00:00.000Z', type: 'session_meta', payload: { cwd: '/tmp' } }),
		], 3000); // newer than other fixtures

		const result = await loadCodexRateLimits();
		// Falls back to whichever session DID have rate_limits — the previous "rollout-new"
		expect(result).not.toBeNull();
		expect(result!.snapshotAt).toBe('2026-04-30T01:40:00.000Z');
	});

	it('handles plan_type null (API-key auth)', async () => {
		const dir = path.join(tmpHome, 'sessions', '2026', '04', '30');
		makeSession(dir, 'rollout-apikey.jsonl', [JSON.stringify({
			timestamp: '2026-04-30T03:00:00.000Z',
			type: 'event_msg',
			payload: {
				type: 'token_count',
				rate_limits: { primary: null, secondary: null, plan_type: null },
			},
		})], 4000);

		const result = await loadCodexRateLimits();
		expect(result).not.toBeNull();
		expect(result!.planType).toBeNull();
		expect(result!.primary).toBeNull();
		expect(result!.secondary).toBeNull();
	});
});
```

- [ ] **Step 1.3: Run tests, confirm they fail**

Run: `npx vitest run src/loaders/codex.test.ts`
Expected: FAIL — `loadCodexRateLimits is not exported from './codex.js'`.

- [ ] **Step 1.4: Implement `loadCodexRateLimits` in `src/loaders/codex.ts`**

Add at the bottom of the file (after `loadCodexEvents`):

```typescript
import type { CodexRateLimits, CodexWindowUsage } from '../types.js';
// ^ Add to existing import line at top of file alongside UnifiedTokenEvent.

function parseRateLimitWindow(raw: unknown): CodexWindowUsage | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const used = typeof r.used_percent === 'number' ? r.used_percent : null;
	const windowMin = typeof r.window_minutes === 'number' ? r.window_minutes : null;
	const resetsUnix = typeof r.resets_at === 'number' ? r.resets_at : null;
	if (used === null || windowMin === null) return null;
	return {
		utilization: used,
		windowMinutes: windowMin,
		resetsAt: resetsUnix !== null ? new Date(resetsUnix * 1000).toISOString() : null,
	};
}

/// Read the most recent rate_limits snapshot Codex has written to its
/// session JSONL files. Returns null when:
///   - no Codex installation is detected
///   - no session contains a rate_limits-bearing event
/// Sessions are scanned newest-first (by mtime); the LAST rate_limits
/// entry within the newest session that contains one wins.
export async function loadCodexRateLimits(): Promise<CodexRateLimits | null> {
	const codexDir = getCodexDir();
	if (!codexDir) return null;

	const sessionsDir = path.join(codexDir, 'sessions');
	const files = await glob('**/*.jsonl', { cwd: sessionsDir, absolute: true, stats: true });
	if (files.length === 0) return null;

	// tinyglobby with stats:true returns { name, path, dirent, ... } depending
	// on version. Fall back to fs.stat if shape doesn't include mtime.
	const withMtime = await Promise.all(files.map(async (entry: any) => {
		const filePath = typeof entry === 'string' ? entry : entry.path ?? entry.name;
		const { stat } = await import('node:fs/promises');
		const s = await stat(filePath);
		return { path: filePath, mtimeMs: s.mtimeMs };
	}));

	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

	const { readFile } = await import('node:fs/promises');
	for (const { path: file } of withMtime) {
		let content: string;
		try {
			content = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		let lastSnapshot: CodexRateLimits | null = null;
		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			let entry: Record<string, unknown>;
			try {
				entry = JSON.parse(trimmed);
			} catch {
				continue;
			}

			if (entry.type !== 'event_msg') continue;
			const payload = entry.payload as Record<string, unknown> | undefined;
			if (!payload || payload.type !== 'token_count') continue;
			const rl = payload.rate_limits as Record<string, unknown> | undefined;
			if (!rl) continue;
			const ts = typeof entry.timestamp === 'string' ? entry.timestamp : null;
			if (!ts) continue;

			lastSnapshot = {
				planType: typeof rl.plan_type === 'string' ? rl.plan_type : null,
				primary: parseRateLimitWindow(rl.primary),
				secondary: parseRateLimitWindow(rl.secondary),
				snapshotAt: ts,
			};
		}

		if (lastSnapshot) return lastSnapshot;
	}

	return null;
}
```

- [ ] **Step 1.5: Run tests, confirm they pass**

Run: `npx vitest run src/loaders/codex.test.ts`
Expected: 4 tests passing.

- [ ] **Step 1.6: Commit Phase 1 Task 1**

```bash
git add src/types.ts src/loaders/codex.ts src/loaders/codex.test.ts src/loaders/__fixtures__/
git commit -m "feat(loaders): extract Codex rate limits from JSONL sessions"
```

---

### Task 2: Wire rate limits into DashboardData

**Files:**
- Modify: `src/types.ts`
- Modify: `src/loaders/index.ts`
- Modify: `src/aggregator.ts`
- Modify: `src/index.ts`

- [ ] **Step 2.1: Add `codexRateLimits` to `DashboardData`**

Modify `src/types.ts`, in the `DashboardData` interface, add a field after `heatmap`:

```typescript
export interface DashboardData {
	// ... existing fields ...
	heatmap: HeatmapCell[];
	/// Live snapshot of Codex CLI rate-limit state. Null when:
	///   - Codex isn't installed
	///   - the user has no session containing a rate_limits-bearing event
	///   - the user authenticates via OPENAI_API_KEY (planType = null)
	/// Consumers should treat null as "Codex limits unavailable".
	codexRateLimits: CodexRateLimits | null;
}
```

- [ ] **Step 2.2: Update `loadAll` to include rate-limits result**

Modify `src/loaders/index.ts`. Add to `LoadAllResult`:

```typescript
import type { CodexRateLimits } from '../types.js';
import { loadCodexRateLimits } from './codex.js';
// ^ Adjust existing imports.

export type LoadAllResult = {
	events: UnifiedTokenEvent[];
	detected: Source[];
	errors: Array<{ source: Source; error: string }>;
	codexRateLimits: CodexRateLimits | null;
};
```

In the `loadAll` function, after the existing `Promise.allSettled` block, add a parallel call for rate limits:

```typescript
export async function loadAll(quiet = false): Promise<LoadAllResult> {
	// ... existing code ...

	// Fetch rate limits concurrently with events. Failures are non-fatal —
	// we just degrade to null so the widget hides the Codex toggle.
	let codexRateLimits: CodexRateLimits | null = null;
	try {
		codexRateLimits = await loadCodexRateLimits();
	} catch (err) {
		log(pc.yellow(`  warn: failed to read codex rate limits: ${String(err)}`));
	}

	events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return { events, detected, errors, codexRateLimits };
}
```

(Could be done in parallel with the loaders' Promise.allSettled, but rate-limits read is fast and the loaders dominate.)

- [ ] **Step 2.3: Pass rate limits through `buildDashboardData`**

Modify `src/aggregator.ts`. Change `buildDashboardData` signature:

```typescript
export function buildDashboardData(
	events: UnifiedTokenEvent[],
	codexRateLimits: import('./types.js').CodexRateLimits | null = null,
): DashboardData {
	// ... existing body unchanged until return ...
	return {
		generated: new Date().toISOString(),
		totals: { /* ... */ },
		daily,
		// ... existing fields ...
		heatmap,
		codexRateLimits,
	};
}
```

- [ ] **Step 2.4: Wire through in `src/index.ts`**

Modify `src/index.ts`. Find the `loadAll` call and the `buildDashboardData` calls (there are 3 sites: empty-store JSON branch, main JSON output, and the live-reload closure). Pass `codexRateLimits` through:

```typescript
const { events: scanned, detected, errors, codexRateLimits } = await loadAll(json);
// ...
if (json) {
	process.stdout.write(JSON.stringify(buildDashboardData([], codexRateLimits), null, 2));
	return;
}
// ...
const data = buildDashboardData(store.events, codexRateLimits);
// ...
const reloadDashboardData = async () => {
	const { events: fresh, codexRateLimits: freshLimits } = await loadAll(true);
	// ...
	return buildDashboardData(store.events, freshLimits);
};
```

- [ ] **Step 2.5: Run all backend tests, confirm nothing regressed**

Run: `npx vitest run`
Expected: all existing tests pass; new codex tests pass; total test count is previous + 4.

- [ ] **Step 2.6: Manual smoke test of `tokenbbq scan`**

Run:
```bash
npm run build
node dist/index.js scan | python -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('codexRateLimits'), indent=2))"
```
Expected: prints your real Codex rate limits in JSON form (planType, primary.utilization, etc.).

- [ ] **Step 2.7: Commit Phase 1 Task 2**

```bash
git add src/types.ts src/loaders/index.ts src/aggregator.ts src/index.ts
git commit -m "feat(scan): expose Codex rate limits in DashboardData"
```

---

## Phase 2 — Tauri DTO + Command

### Task 3: Surface Codex usage in `fetch_local_usage`

**Files:**
- Modify: `widget/src-tauri/src/api_types.rs`
- Modify: `widget/src-tauri/src/commands.rs`

- [ ] **Step 3.1: Add `CodexUsage` DTO to `api_types.rs`**

Append after the `ClaudeUsageResponse` block:

```rust
/// Mirror of TokenBBQ's CodexRateLimits TS interface. Field names use
/// camelCase to match the JSON the sidecar emits (TS interface uses
/// camelCase; serde_json passes them through verbatim because we read
/// via the projection in fetch_local_usage rather than typed deserialization).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWindowUsage {
    pub utilization: f64,
    pub window_minutes: u32,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsage {
    pub plan_type: Option<String>,
    pub primary: Option<CodexWindowUsage>,
    pub secondary: Option<CodexWindowUsage>,
    pub snapshot_at: String,
}
```

Then extend `LocalUsageSummary`:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageSummary {
    pub generated: String,
    pub today_date: Option<String>,
    pub today_tokens: u64,
    pub week_tokens: u64,
    pub today_by_source: Vec<SourceSpend>,
    /// Live Codex rate-limit snapshot, projected from the sidecar JSON.
    /// None when Codex isn't installed, no rate-limits event was ever
    /// emitted, or the user has API-key auth (plan_type null).
    pub codex_usage: Option<CodexUsage>,
}
```

- [ ] **Step 3.2: Project `codexRateLimits` from sidecar output in `fetch_local_usage`**

Modify `widget/src-tauri/src/commands.rs`. Update the imports:

```rust
use crate::api_types::{ClaudeUsageResponse, CodexUsage, LocalUsageSummary, Settings, SettingsDisplay, SourceSpend};
```

In `fetch_local_usage`, after the `today_by_source` projection block (~line 384), add:

```rust
let codex_usage: Option<CodexUsage> = raw
    .get("codexRateLimits")
    .and_then(|v| if v.is_null() { None } else { Some(v.clone()) })
    .and_then(|v| serde_json::from_value::<CodexUsage>(v).ok());
```

Then update the final `Ok(LocalUsageSummary { ... })` to include `codex_usage`.

- [ ] **Step 3.3: Build the sidecar and the widget**

Run:
```bash
npm run build:sidecar 2>&1 | tail -5
cd widget && npm run tauri build -- --debug 2>&1 | tail -5
cd ..
```
Expected: both succeed without errors. (If `build:sidecar` script doesn't exist, use `npm run build` from repo root and verify `dist/index.js` is fresh.)

- [ ] **Step 3.4: Smoke-check the Tauri command output**

Verify the new field arrives at the widget by adding a temporary `console.log("codexUsage:", local.codexUsage)` in `widget/src/main.ts` `fetchLocalUsage()`, run the widget in dev (`npm run tauri dev` from `widget/`), open DevTools, and inspect that `codexUsage` is the expected object.

Remove the `console.log` before committing.

- [ ] **Step 3.5: Commit Phase 2**

```bash
git add widget/src-tauri/src/api_types.rs widget/src-tauri/src/commands.rs
git commit -m "feat(widget/tauri): expose Codex rate limits via fetch_local_usage"
```

---

## Phase 3 — Widget Data Layer + Toggle State

### Task 4: TypeScript types + source-toggle state

**Files:**
- Modify: `widget/src/types.ts`
- Modify: `widget/src/main.ts`
- Create: `widget/src/source-toggle.ts`

- [ ] **Step 4.1: Add Codex types to widget**

Modify `widget/src/types.ts`. Add:

```typescript
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
```

Then update `LocalUsageSummary`:

```typescript
export interface LocalUsageSummary {
	generated: string;
	todayDate: string | null;
	todayTokens: number;
	weekTokens: number;
	todayBySource: { source: string; tokens: number }[];
	codexUsage: CodexUsage | null;
}
```

(Adjust to whatever fields already exist — only add `codexUsage`.)

- [ ] **Step 4.2: Create `widget/src/source-toggle.ts`**

```typescript
/// User preference for which sources the pill should display.
/// "claude" = Claude Code Subscription only (current default behavior)
/// "codex"  = Codex only
/// "both"   = stacked dual-mode (pill is taller)
export type SourceMode = 'claude' | 'codex' | 'both';

const STORAGE_KEY_CLAUDE = 'tokenbbq-show-claude';
const STORAGE_KEY_CODEX = 'tokenbbq-show-codex';

export interface SourceToggleState {
	claude: boolean;
	codex: boolean;
}

/// Read the toggle state from localStorage. Defaults: Claude on, Codex
/// off (matching legacy behavior — we don't auto-enable Codex on first
/// run because not every user has Codex installed; we want the pill
/// to look identical until they explicitly opt in).
export function loadToggleState(): SourceToggleState {
	const claude = localStorage.getItem(STORAGE_KEY_CLAUDE);
	const codex = localStorage.getItem(STORAGE_KEY_CODEX);
	return {
		claude: claude === null ? true : claude === '1',
		codex: codex === '1',
	};
}

export function saveToggleState(state: SourceToggleState): void {
	localStorage.setItem(STORAGE_KEY_CLAUDE, state.claude ? '1' : '0');
	localStorage.setItem(STORAGE_KEY_CODEX, state.codex ? '1' : '0');
}

/// Resolve the effective render mode given user toggles AND data
/// availability. If the user toggled Codex on but the sidecar reports
/// codexUsage=null (no plan / no data), we silently fall back so the
/// pill never renders empty rows.
export function resolveMode(
	state: SourceToggleState,
	hasClaudeData: boolean,
	hasCodexData: boolean,
): SourceMode {
	const effClaude = state.claude && hasClaudeData;
	const effCodex = state.codex && hasCodexData;
	if (effClaude && effCodex) return 'both';
	if (effCodex) return 'codex';
	return 'claude';  // default — matches legacy behavior even if !hasClaudeData
}
```

- [ ] **Step 4.3: Wire toggle state into `main.ts`**

Modify `widget/src/main.ts`. Top-level imports:

```typescript
import { loadToggleState, saveToggleState, resolveMode, type SourceToggleState } from "./source-toggle";
```

Add module-level state (near `lastUsageJson`):

```typescript
let toggleState: SourceToggleState = loadToggleState();
```

In `init()`, after the existing load/setup but BEFORE `startPolling`, no change needed yet — the toggle UI is rendered in Phase 4 inside renderExpanded.

Don't yet wire toggle event handlers — that comes in Phase 4 Task 5.

- [ ] **Step 4.4: Commit Phase 3**

```bash
git add widget/src/types.ts widget/src/source-toggle.ts widget/src/main.ts
git commit -m "feat(widget): add Codex types and source-toggle state module"
```

---

## Phase 4 — Expanded Panel: Replace Subscription Section with Toggles

### Task 5: Toggle-row UI in expanded panel

**Files:**
- Modify: `widget/src/ui.ts`
- Modify: `widget/src/styles.css`
- Modify: `widget/src/main.ts`

- [ ] **Step 5.1: Add toggle-row HTML helper to `ui.ts`**

In `widget/src/ui.ts`, add helper functions and brand-icon constants near the top (after `clockSvg`):

```typescript
const claudeBadgeSvg = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>`;
// ^ Placeholder; replaced with real Claude Code mark in Phase 6 Task 8.
const codexBadgeSvg = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>`;
// ^ Placeholder; replaced with real OpenAI/Codex mark in Phase 6 Task 8.

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
```

- [ ] **Step 5.2: Replace Subscription rows with toggles in `renderExpanded`**

In `widget/src/ui.ts`, modify `renderExpanded` to take the toggle state + Codex data, and render toggle rows where the Claude windows used to be:

```typescript
export function renderExpanded(
	usage: ClaudeUsageResponse,
	local: LocalUsageSummary | null = null,
	toggleState: { claude: boolean; codex: boolean } = { claude: true, codex: false },
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

	// Extra Usage panel — kept as before, since it's claude.ai paid credits
	if (usage.extra_usage && usage.extra_usage.is_enabled) {
		// ... existing extra_usage block (unchanged) ...
	}

	if (local) {
		html += renderLocalExpandedHtml(local);
	}

	container.innerHTML = html;

	if (document.getElementById("expanded-view")!.classList.contains("visible")) {
		requestAnimationFrame(() => requestAnimationFrame(() => { void fitExpandedToContent(); }));
	}
}
```

(Keep the existing `usageRowHtml` function in the file unused for now — we'll delete it in cleanup once Phase 6 is verified, in case we want to bring details back.)

- [ ] **Step 5.3: Add toggle-row CSS to `styles.css`**

In `widget/src/styles.css`, append:

```css
/* Source-toggle list — replaces the old "Claude.ai Subscription" rows
   in the expanded panel. Each row is logo + label + iOS-style switch. */
.source-toggle-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 4px 0 12px;
}
.source-toggle-row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 10px;
	border-radius: 8px;
	background: var(--surface-2, rgba(255, 255, 255, 0.04));
}
.source-toggle-row.disabled {
	opacity: 0.5;
}
.source-toggle-logo {
	width: 18px;
	height: 18px;
	color: var(--text-secondary, #aaa);
	display: inline-flex;
	flex-shrink: 0;
}
.source-toggle-logo svg {
	width: 100%;
	height: 100%;
}
.source-toggle-label {
	flex: 1;
	font-size: 13px;
	color: var(--text-primary);
	display: flex;
	flex-direction: column;
}
.source-toggle-hint {
	font-size: 10px;
	color: var(--text-tertiary, #666);
	margin-top: 1px;
}
.source-toggle-switch {
	position: relative;
	width: 32px;
	height: 18px;
	cursor: pointer;
}
.source-toggle-switch input {
	opacity: 0;
	width: 0;
	height: 0;
}
.source-toggle-slider {
	position: absolute;
	inset: 0;
	background: var(--border-color, #444);
	border-radius: 18px;
	transition: background 0.15s;
}
.source-toggle-slider::before {
	content: '';
	position: absolute;
	width: 14px;
	height: 14px;
	left: 2px;
	top: 2px;
	background: white;
	border-radius: 50%;
	transition: transform 0.15s;
}
.source-toggle-switch input:checked + .source-toggle-slider {
	background: var(--accent, #74aa9c);
}
.source-toggle-switch input:checked + .source-toggle-slider::before {
	transform: translateX(14px);
}
.source-toggle-switch input:disabled ~ .source-toggle-slider {
	cursor: not-allowed;
}
```

- [ ] **Step 5.4: Wire toggle change events in `main.ts`**

In `widget/src/main.ts`, update `fetchUsage` to pass toggle state and the existing `renderExpanded` call sites:

```typescript
async function fetchUsage(): Promise<void> {
	try {
		const usage = await invoke<ClaudeUsageResponse>("fetch_usage");
		const json = JSON.stringify(usage);
		if (json === lastUsageJson) return;
		lastUsageJson = json;
		renderCompact(usage, lastLocal, toggleState);
		renderExpanded(usage, lastLocal, toggleState);
	} catch (e) {
		renderError(String(e));
	}
}
```

(`renderCompact` signature change is in Phase 5 — for now stub-call it with extra args; TS will complain, that's fine for this incremental step.)

In `setupEventListeners()`, add a delegated handler on `usage-bars`:

```typescript
document.getElementById("usage-bars")!.addEventListener("change", (e) => {
	const target = e.target as HTMLInputElement;
	if (target.id === "toggle-claude") toggleState.claude = target.checked;
	else if (target.id === "toggle-codex") toggleState.codex = target.checked;
	else return;
	saveToggleState(toggleState);
	// Re-render: re-issue last data through new mode without an extra fetch.
	if (lastUsageJson) {
		try {
			const usage = JSON.parse(lastUsageJson) as ClaudeUsageResponse;
			renderCompact(usage, lastLocal, toggleState);
			renderExpanded(usage, lastLocal, toggleState);
		} catch {}
	}
});
```

Add `saveToggleState` to imports.

- [ ] **Step 5.5: Manual smoke test**

Run `npm run tauri dev` from `widget/`. Open expanded view. Verify:
- "Pill displays" section shows two rows: Claude Code (on), Codex (off if no Codex data, or on/off-able if Codex data present).
- Toggling Claude off and Codex on persists across widget restart.
- The pill itself doesn't yet change layout (Phase 5+ work).

- [ ] **Step 5.6: Commit Phase 4**

```bash
git add widget/src/ui.ts widget/src/styles.css widget/src/main.ts
git commit -m "feat(widget): replace Subscription section with source toggles"
```

---

## Phase 5 — Pill: Generalize for Single-Source (Codex)

### Task 6: Mode-aware `renderCompact`

**Files:**
- Modify: `widget/src/ui.ts`
- Modify: `widget/src/main.ts`

- [ ] **Step 6.1: Refactor `renderCompact` to accept `(usage, local, toggleState)`**

Replace the current `renderCompact` in `widget/src/ui.ts` with a mode dispatcher. Single-mode keeps the existing layout exactly — only the data source changes:

```typescript
import { resolveMode, type SourceToggleState } from './source-toggle';

export function renderCompact(
	usage: ClaudeUsageResponse,
	local: LocalUsageSummary | null,
	toggleState: SourceToggleState,
): void {
	const codex = local?.codexUsage ?? null;
	const hasClaude = !!(usage.five_hour || usage.seven_day);
	const hasCodex = codex !== null && codex.planType !== null && (codex.primary !== null || codex.secondary !== null);
	const mode = resolveMode(toggleState, hasClaude, hasCodex);

	const fiveHour = document.getElementById("five-hour-compact")!;
	const sevenDay = document.getElementById("seven-day-compact")!;
	const fiveHourLabel = document.getElementById("five-hour-label")!;
	const sevenDayLabel = document.getElementById("seven-day-label")!;

	if (mode === 'codex' && codex) {
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

	if (mode === 'both') {
		// Dual-mode rendering — handled by renderCompactDual (Phase 6).
		// Fall through to single-claude until Phase 6 lands.
	}

	// Default / single-claude mode — original behavior.
	const fhPct = usage.five_hour?.utilization ?? 0;
	const sdPct = usage.seven_day?.utilization ?? 0;
	fiveHour.textContent = `${Math.round(fhPct)}%`;
	fiveHour.style.color = utilizationColor(fhPct);
	sevenDay.textContent = `${Math.round(sdPct)}%`;
	sevenDay.style.color = utilizationColor(sdPct);
	fiveHourLabel.textContent = formatHoursCompact(usage.five_hour?.resets_at ?? null) || "5h";
	sevenDayLabel.textContent = formatDaysCompact(usage.seven_day?.resets_at ?? null) || "7d";
}
```

- [ ] **Step 6.2: Smoke test single-Codex mode**

Toggle Claude off + Codex on in expanded view. Pill should now show your Codex 5h/7d percentages (38%, 11% or whatever's current). No layout change — same single-line pill. The TokenBBQ flame icon stays.

- [ ] **Step 6.3: Commit Phase 5**

```bash
git add widget/src/ui.ts widget/src/main.ts
git commit -m "feat(widget): pill renders Codex single-source when toggled"
```

---

## Phase 6 — Pill: Dual-Mode Layout

### Task 7: HTML/CSS restructure for stacked dual-mode

**Files:**
- Modify: `widget/index.html`
- Modify: `widget/src/styles.css`
- Modify: `widget/src/ui.ts`

- [ ] **Step 7.1: Add a hidden "second row" structure to `index.html`**

In `widget/index.html`, replace the `#compact-view .pill` body. Goal: the pill has a `.pill-rows` wrapper containing one or two `.pill-row` elements. The first row is the existing structure; the second row is duplicated for dual-mode and hidden by default.

```html
<div id="compact-view" class="pill">
	<img src="/src/assets/tokenbbq-icon.png" alt="" class="pill-fire" width="30" height="30">
	<div class="pill-rows" id="pill-rows">
		<div class="pill-row" data-source="primary">
			<span class="pill-row-logo" id="pill-row-logo-primary" hidden></span>
			<div class="pill-metrics">
				<div class="pill-metric">
					<span class="pill-metric-value" id="five-hour-compact">—</span>
					<span class="pill-metric-label" id="five-hour-label">5h</span>
				</div>
				<div class="pill-metric">
					<span class="pill-metric-value" id="seven-day-compact">—</span>
					<span class="pill-metric-label" id="seven-day-label">7d</span>
				</div>
			</div>
		</div>
		<div class="pill-row" data-source="secondary" hidden id="pill-row-secondary">
			<span class="pill-row-logo" id="pill-row-logo-secondary"></span>
			<div class="pill-metrics">
				<div class="pill-metric">
					<span class="pill-metric-value" id="five-hour-compact-2">—</span>
					<span class="pill-metric-label" id="five-hour-label-2">5h</span>
				</div>
				<div class="pill-metric">
					<span class="pill-metric-value" id="seven-day-compact-2">—</span>
					<span class="pill-metric-label" id="seven-day-label-2">7d</span>
				</div>
			</div>
		</div>
	</div>
	<div class="pill-divider" id="pill-divider" hidden></div>
	<div class="pill-metrics pill-metrics-local" id="pill-local" hidden>
		<div class="pill-metric">
			<span class="pill-metric-value" id="today-compact">—</span>
			<span class="pill-metric-label">today</span>
		</div>
	</div>
	<div class="grip-handle" id="pill-grip" title="Drag to move">
		<span></span><span></span><span></span><span></span><span></span><span></span>
	</div>
</div>
```

- [ ] **Step 7.2: CSS for dual-mode rows**

In `widget/src/styles.css`, find the existing `.pill` block (the compact-view styles). Adjust:

```css
/* Compact-pill rows: vertical stack when dual-mode is active. The
   .pill-rows container aligns the burn-rate icon (left) with whichever
   row(s) follow. In single-mode there's one row, height stays 64px;
   dual-mode adds a second row and the host window grows to ~110px
   via setCompactSize() in main.ts. */
.pill-rows {
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 4px;
	flex: 1;
}
.pill-row {
	display: flex;
	align-items: center;
	gap: 8px;
}
.pill-row-logo {
	width: 14px;
	height: 14px;
	display: inline-flex;
	color: var(--text-secondary, #aaa);
	flex-shrink: 0;
}
.pill-row-logo svg {
	width: 100%;
	height: 100%;
}
.pill-row-logo[hidden] {
	display: none;
}
/* Tighter metric layout in dual-mode so two rows fit without ballooning. */
.pill.dual-mode .pill-metric-value {
	font-size: 14px;
}
.pill.dual-mode .pill-metric-label {
	font-size: 9px;
}
```

(Adjust selectors/var names to match the actual existing CSS — read the file first and align.)

- [ ] **Step 7.3: Define `COMPACT_SIZE_DUAL` and a `setCompactSize` helper in `ui.ts`**

In `widget/src/ui.ts`, replace the const `COMPACT_SIZE` with:

```typescript
const COMPACT_SIZE_SINGLE = { width: 320, height: 64 };
const COMPACT_SIZE_DUAL = { width: 320, height: 110 };

export function compactSizeForMode(mode: SourceMode): { width: number; height: number } {
	return mode === 'both' ? COMPACT_SIZE_DUAL : COMPACT_SIZE_SINGLE;
}
```

Replace usage of `COMPACT_SIZE` in `setViewState` with a call that resolves at runtime — but since `setViewState` doesn't yet know the mode, accept it as an optional param:

```typescript
export async function setViewState(state: ViewState, mode: SourceMode = 'claude'): Promise<void> {
	// ... existing code ...
	if (state === "compact") {
		settings.classList.remove("visible");
		panel.classList.remove("visible");
		pill.classList.remove("hidden-pill");
		pill.classList.toggle("dual-mode", mode === 'both');
		const sz = compactSizeForMode(mode);
		await win.setSize(new LogicalSize(sz.width, sz.height));
	}
	// ... rest unchanged ...
}
```

In `main.ts`, callers of `setViewState("compact")` now pass the resolved mode. Add a helper:

```typescript
function currentMode(): SourceMode {
	const local = lastLocal;
	const usage = lastUsageJson ? JSON.parse(lastUsageJson) as ClaudeUsageResponse : null;
	const hasClaude = !!(usage?.five_hour || usage?.seven_day);
	const hasCodex = !!(local?.codexUsage && local.codexUsage.planType !== null
		&& (local.codexUsage.primary || local.codexUsage.secondary));
	return resolveMode(toggleState, hasClaude, hasCodex);
}
```

Then update collapse() and toggle-change handler to call `setViewState("compact", currentMode())`.

- [ ] **Step 7.4: Implement dual-mode rendering in `renderCompact`**

Extend `renderCompact` to populate the second row when `mode === 'both'`:

```typescript
if (mode === 'both' && codex) {
	// Show the second row.
	document.getElementById('pill-row-secondary')!.removeAttribute('hidden');
	document.getElementById('pill-row-logo-primary')!.removeAttribute('hidden');
	document.getElementById('pill-row-logo-primary')!.innerHTML = claudeBadgeSvg;
	document.getElementById('pill-row-logo-secondary')!.innerHTML = codexBadgeSvg;

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
	document.getElementById('five-hour-compact-2')!.textContent = `${Math.round(fhPctX)}%`;
	(document.getElementById('five-hour-compact-2') as HTMLElement).style.color = utilizationColor(fhPctX);
	document.getElementById('seven-day-compact-2')!.textContent = `${Math.round(sdPctX)}%`;
	(document.getElementById('seven-day-compact-2') as HTMLElement).style.color = utilizationColor(sdPctX);
	document.getElementById('five-hour-label-2')!.textContent = formatHoursCompact(codex.primary?.resetsAt ?? null) || "5h";
	document.getElementById('seven-day-label-2')!.textContent = formatDaysCompact(codex.secondary?.resetsAt ?? null) || "7d";
	return;
}

// In single-mode: hide secondary row + logos
document.getElementById('pill-row-secondary')!.setAttribute('hidden', '');
document.getElementById('pill-row-logo-primary')!.setAttribute('hidden', '');
```

- [ ] **Step 7.5: Smoke test dual-mode**

Toggle Claude on + Codex on. Verify:
- Pill window grows to ~110px height.
- Two stacked rows: top Claude, bottom Codex.
- Each row has a small logo (placeholder shapes for now).
- Toggling back to single-mode shrinks the window.

- [ ] **Step 7.6: Commit Phase 6 Task 7**

```bash
git add widget/index.html widget/src/styles.css widget/src/ui.ts widget/src/main.ts
git commit -m "feat(widget): pill dual-mode renders stacked Claude + Codex rows"
```

---

### Task 8: Real brand SVGs

**Files:**
- Modify: `widget/src/ui.ts`

- [ ] **Step 8.1: Replace placeholder SVGs with real brand marks**

In `widget/src/ui.ts`, replace the placeholder `claudeBadgeSvg` / `codexBadgeSvg` with monochrome marks. Use simple outline paths so they tint via `currentColor`:

```typescript
// Anthropic / Claude C-mark — simplified outline.
const claudeBadgeSvg = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
	<path d="M5 4h3l4 16H9zM12 4h3l4 16h-3z"/>
</svg>`;

// OpenAI knot — simplified mark.
const codexBadgeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
	<circle cx="12" cy="12" r="9"/>
	<path d="M7 12a5 5 0 0 1 10 0M17 12a5 5 0 0 1-10 0" stroke-linecap="round"/>
</svg>`;
```

(If you have official brand assets the user prefers, drop them as files in `widget/src/assets/` and import as URLs — but for the toggle-row + pill-row context, inline SVGs that inherit color via `currentColor` integrate better with the dark/light theme system.)

- [ ] **Step 8.2: Smoke test brand visibility in dark + light themes**

Run `npm run tauri dev`. Toggle theme between dark and light in Settings. Verify both logos are visible and adopt the foreground color.

- [ ] **Step 8.3: Commit Phase 6 Task 8**

```bash
git add widget/src/ui.ts
git commit -m "feat(widget): real Claude + OpenAI brand marks for pill dual-mode"
```

---

## Phase 7 — Verification & Polish

### Task 9: End-to-end verification + edge cases

**Files:**
- Modify (potentially): `widget/src/main.ts`, `widget/src/ui.ts`

- [ ] **Step 9.1: Build everything from clean state**

```bash
git status  # confirm clean
npm run build
cd widget && npm run tauri build -- --debug
cd ..
```

Expected: both succeed.

- [ ] **Step 9.2: Run the WHOLE program (sidecar + widget together)**

This is a Multi-Surface product (per project memory). Verify all surfaces:
- Start widget — should auto-poll sidecar.
- Open `npx tokenbbq dashboard` in another terminal — verify the dashboard renders correctly with the new `codexRateLimits` field present in JSON (browser DevTools → check `__latestData.codexRateLimits`).
- Verify both work simultaneously without sidecar conflicts.

- [ ] **Step 9.3: Manual UAT scenarios**

Test each scenario in the running widget:

1. **Single Claude (default first-launch):** Pill = legacy layout, no logos, 5h%/7d% from claude.ai.
2. **Single Codex:** Toggle Claude off, Codex on. Pill = legacy layout (no logos), values from local Codex JSONL.
3. **Dual:** Both toggles on. Pill = stacked rows with logos, claude on top, codex below. Window taller.
4. **Codex unavailable:** If you remove `~/.codex` temporarily (or rename it), Codex toggle is disabled with hint "(no data)". Toggling it has no effect; pill stays in single-claude mode.
5. **Both off (edge):** If user toggles both off, pill defaults to single-claude (resolveMode fallback).
6. **Toggle while in expanded view:** Switch toggles in expanded view — pill behind isn't visible. Collapse, verify pill matches new toggle state. Window resize is smooth.
7. **Window-anchor preservation:** Toggle into dual-mode while pill is at right edge of screen — pill should stay anchored, growing downward, not jumping.

If scenario 7 fails (pill jumps), the dual-mode resize needs to compensate. Find the anchor logic (recent commit `bbb5064 feat(widget): anchor pill on right edge at 60% screen height`) and adjust to re-anchor after `setSize` when collapsing into dual-mode.

- [ ] **Step 9.4: Edge-case fixups (only if issues found in 9.3)**

Document any deviations from expected behavior. Fix in-place. Re-test the affected scenario.

- [ ] **Step 9.5: Final commit + push**

```bash
git status  # should be clean if no extra fixups needed
git push -u origin feat/codex-rate-limits-pill-toggle
```

If the user wants a PR rather than direct merge, `gh pr create` from there.

---

## Risks / Eigenheiten

- **Codex rate-limit reads are filesystem reads.** Sidecar is short-lived (~2s), so cost is negligible. But if a user has thousands of session files, the mtime sort + read of the latest file is O(n) on number of files. We accept this — Codex sessions are typically <500 in normal use.
- **localStorage is per-widget-window.** If the user reinstalls / clears app data, toggle state resets to defaults (Claude on, Codex off).
- **`codexRateLimits` is null for API-key auth.** Toggle is disabled with a hint; pill never renders empty Codex rows.
- **Snapshot freshness:** Codex rate-limits represent the state at the user's last Codex API call. If they haven't used Codex for hours, the percentage is stale — but never artificially low (`used_percent` only goes UP within a window). User explicitly opted out of an "as of HH:MM" hint; we show the value bare.
- **`fix/windows-console-flash` branch** is unrelated — we branched from master. If that branch has unmerged commits the widget still needs, rebase/merge it before testing on master to avoid regressing the Windows console flash fix.

---

## Self-Review Checklist Results

- **Spec coverage:** All four spec items covered — backend extraction (Phase 1), Tauri pipe (Phase 2), expanded toggles (Phase 4), pill single+dual modes (Phases 5-6), brand logos (Phase 6 Task 8). User-explicit "no as-of stamp" honored throughout.
- **Placeholders:** None — every step has actual code or a concrete command.
- **Type consistency:** `CodexRateLimits` (TS) / `CodexUsage` (Rust) names diverge by language convention but field names align (`planType`/`plan_type`, etc.) via serde rename. Sidecar emits camelCase JSON; Tauri reads via Value projection then typed deserialize.
- **Brand SVGs:** The Step 8.1 marks are simplified — if the user wants licensed/official marks, swap before shipping a public release.
