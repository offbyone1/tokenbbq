# Project Tracking — Design

**Date:** 2026-04-23
**Scope:** `src/types.ts`, all loaders, `src/aggregator.ts`, `src/dashboard.ts`, new `src/project.ts`
**Status:** Design approved, pending user review

## Context

TokenBBQ already has the plumbing for per-project aggregation: `UnifiedTokenEvent.project` exists in `types.ts`, `aggregateByProject` exists in `aggregator.ts`, and `DashboardData.byProject` is computed and returned. But nothing consumes it — the dashboard does not render projects, the CLI does not print them, and only 3 of 6 loaders populate the field (Claude Code partially, Pi-Agent, Gemini when the folder is not a hash).

This spec covers (1) reliably extracting the project from every source's raw data, (2) collapsing sub-directory events into their real project, and (3) showing the result in a new dashboard section between the activity heatmap and the daily breakdown table.

## Decisions (locked)

### Project identity

**A project is one existing directory on the user's filesystem.** The project's internal identifier is the absolute path of that directory; the display name is the directory's basename.

**Root resolution:** For a given `cwd`, walk up the tree until a directory containing any of these markers is found. Git is one marker among many — a project without Git is handled identically to one with Git.

- VCS: `.git`, `.hg`, `.svn`
- Package manifests: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.csproj`
- Common top-level files: `README.md`, `.gitignore`, `CHANGELOG.md`

The walk stops at the user's home directory and at the filesystem root — we never ascend above `$HOME` or above a drive letter on Windows. If no marker is found within those bounds, the `cwd` itself is the project root.

**Display name:** `path.basename(projectRoot)`. No path components, no slashes, no hashes, no URL-encoded folder names.

Examples (from the user's real data):
- `C:\Users\maxbl\Desktop\Projekte\TokenBBQ` → root `TokenBBQ`, displayed as `TokenBBQ`.
- `C:\Users\maxbl\Documents\cursor\Particulate\web` → walks up, finds marker at `Particulate`, displayed as `Particulate`.
- `C:\Users\maxbl\Desktop` (no markers) → root `Desktop`, displayed as `Desktop`.

**Labels without paths:** If a source only provides a label (Gemini gives us folder names like `nanogolf`, not absolute paths), use the label as-is for both identifier and display name. No automatic matching against path-based projects — `nanogolf` (Gemini label) and `NanoGolf` (path basename) remain two separate rows.

**Name collisions:** If two different absolute paths resolve to the same basename (e.g. two `translator` folders under different parents), both rows appear in the UI with the identical display name. Internally the absolute path distinguishes them. Automatic disambiguation (adding a path suffix) is out of scope; if it becomes a real annoyance we revisit.

### Loader responsibilities

Every loader populates `UnifiedTokenEvent.project` when its source data allows it. Sources of truth per loader:

| Loader | Source of truth for project | Verified on user machine |
|---|---|---|
| `claude.ts` | `cwd` field inside each JSONL line | ✅ present, e.g. `"cwd":"C:\\Users\\maxbl\\Desktop\\Projekte\\TokenBBQ"` |
| `codex.ts` | `cwd` in the `session_meta` entry (first line of each `.jsonl`) | ✅ present, e.g. `"cwd":"C:\\Users\\maxbl\\Documents\\cursor\\Particulate\\web"` |
| `opencode.ts` | SQLite: `session.directory` (per-session cwd), fallback to `project.worktree` | ✅ present — full rewrite required (see below) |
| `gemini.ts` | Existing folder-name heuristic | ✅ folders like `desktop`, `nanogolf` match on user machine |
| `amp.ts` | Unknown — not installed on user machine | Deferred; events emitted without project |
| `pi.ts` | Existing first-path-segment heuristic | Not installed on user machine; code path kept as-is |

**Project-root resolution is centralized** in `resolveProjectRoot(cwd: string): { root: string; name: string }`, imported by every path-based loader. The function caches results per `cwd` to avoid repeated filesystem probes inside a single `loadAll()` run. Label-only sources (Gemini) bypass the helper and use their label directly.

### OpenCode loader rewrite

Background: on the user's machine the OpenCode loader produces zero events. The current loader at `src/loaders/opencode.ts` reads `storage/message/*.json`, but modern OpenCode has migrated to a SQLite database at `~/.local/share/opencode/opencode.db` with these relevant tables:

- `project` — `id`, `worktree` (absolute path), `name`, `vcs`
- `session` — `id`, `project_id`, `directory` (cwd at session time)
- `message` — `id`, `session_id`, `data` (JSON blob; token counts live inside under `tokens.total/input/output/reasoning/cache.read/cache.write`)
- `part` — also contains token info per tool-call step, but `message.data` is sufficient for aggregation.

The loader is rewritten to read the SQLite file via `sql.js` (pure-JavaScript WebAssembly build of SQLite). Rationale: matches the NDJSON-over-SQLite decision in the persistence spec (no native binary, no engine bump, consistent install story across platforms). `sql.js` weighs ~1 MB, loads the DB once per `loadAll()` run, and is fast enough for the read-only queries we need. If the DB file is absent, the loader is a no-op, matching today's "source not installed" behavior. For each assistant message, the loader builds a `UnifiedTokenEvent` using `session.directory` (cwd at session time), falling back to `project.worktree` if `directory` is missing or empty. The resulting cwd is passed through `resolveProjectRoot`.

If the database is present but empty, or any SQLite read fails, the loader logs a single warning and returns an empty event list — same graceful degradation as other loaders.

### Dashboard UI

A new section inserted **between** the activity heatmap and the daily breakdown table. Styled to match the daily breakdown for visual consistency (same card shell, same table typography, same sort-on-header interaction).

**Layout:** a sortable HTML table, one row per project.

| Project | Providers | Tokens | Cost | Events | Last Active |
|---|---|---|---|---|---|
| TokenBBQ | 🟧 Claude Code · 🟢 Codex | 12.3M | $48.89 | 214 | 2026-04-22 |
| Particulate | 🟢 Codex · 🟦 Gemini | 8.7M | $31.02 | 167 | 2026-04-21 |
| NanoGolf | 🟣 OpenCode | 2.1M | $0.54 | 42 | 2026-04-15 |

- **Project**: bare directory name or Gemini label. Nothing else.
- **Providers**: color chips per `SOURCE_COLORS`, in source order, space-separated.
- **Tokens**: `fmtTokens` formatting (compatible with the dashboard-improvements Track 2 rules — `12.3M`, `1.6B`, etc.).
- **Cost**: `fmtUSD` (always 2 decimals).
- **Events**: raw count with thousands separator via existing `fmt`.
- **Last Active**: most recent event date, `YYYY-MM-DD`.

**Sorting:** default is Tokens descending. Every column header is clickable to re-sort, matching the existing daily-breakdown behavior.

**Row expansion:** out of scope. Can be added later if detail (per-provider split, top model) is wanted.

**Empty state:** if zero projects are detected, the section renders a muted `No project information yet.` line. The section is not hidden — its presence signals that the feature exists.

### Type changes

`UnifiedTokenEvent.project` stays optional. Aggregation is extended:

```ts
interface ProjectAggregation {
  project: string;          // display name (basename)
  projectPath: string;      // absolute path — stable key, used for collision disambiguation
  tokens: TokenCounts;
  costUSD: number;
  sources: Source[];
  eventCount: number;
  lastActive: string;       // ISO date of most recent event (YYYY-MM-DD)
}
```

`aggregateByProject` is updated to populate the new fields. `normalizedProjectName` in `aggregator.ts` is removed — loaders are now responsible for producing usable project values, and the aggregator trusts them. Events with no `project` field are grouped into no aggregation row (they simply don't appear in the project table).

For label-only sources (Gemini), `projectPath` equals `project` (the label itself).

## Architecture

**New module:** `src/project.ts`

- `resolveProjectRoot(cwd: string): { root: string; name: string }` — walks up from `cwd`, applies marker heuristic, caches results per input.
- `isProjectMarker(dir: string): boolean` — internal helper; checks for any of the marker files listed above.

**Modified files:**
- `src/types.ts` — extend `ProjectAggregation` (add `projectPath`, `lastActive`).
- `src/loaders/claude.ts` — replace folder-name decoding with per-line `cwd` extraction; pass through `resolveProjectRoot`. If a JSONL session has no `cwd` on any line, the event is emitted without a project (no URL-decoding fallback — the encoded form loses spaces and umlauts and is misleading).
- `src/loaders/codex.ts` — parse `session_meta` line, extract `cwd`, pass through `resolveProjectRoot`. Cache per session so we only resolve once per file.
- `src/loaders/opencode.ts` — **full rewrite** against SQLite via `node:sqlite`.
- `src/loaders/gemini.ts` — unchanged.
- `src/loaders/pi.ts` — unchanged.
- `src/loaders/amp.ts` — unchanged for now.
- `src/aggregator.ts` — update `aggregateByProject` to compute `lastActive` (the `YYYY-MM-DD` of the latest event's timestamp per project), populate `projectPath`, remove `normalizedProjectName`.
- `src/dashboard.ts` — new section rendering the project table between heatmap and daily breakdown.
- `package.json` — add `sql.js` dependency. No engine bump.

## Non-goals

- No multi-tool project merging beyond path equality. Gemini labels stay separate from path-based projects.
- No manual alias/mapping UI. User-driven merging is a possible v2.
- No collision disambiguation beyond showing both rows with the same display name.
- No per-project row expansion.
- No changes to the CLI output (daily / monthly / summary tables stay as they are).
- No changes to the other dashboard popups or the improvements covered in `2026-04-23-dashboard-improvements-design.md`.
- No Amp loader investigation — deferred until test data is available.

## Testing

Manual verification in browser with real user data.

1. Claude Code events from `C:\Users\maxbl\Desktop\Projekte\TokenBBQ` render under project `TokenBBQ`, not `C--Users-maxbl-Desktop-Projekte-TokenBBQ`.
2. Codex events from `C:\Users\maxbl\Documents\cursor\Particulate\web` collapse to project `Particulate` (walked up via marker in the parent), not `web`.
3. OpenCode data appears in the project table at all (currently absent because the loader is broken).
4. Projects appear in descending token order; every column header sorts correctly.
5. A project touched by two tools shows both provider chips, colored per `SOURCE_COLORS`.
6. A test project that has both `.git` and `package.json` keeps the same project classification after `.git` is temporarily renamed to `_git` (proves Git is not the single point of truth).
7. A `cwd` with no markers at any level resolves to its own basename (e.g. `Desktop` under `C:\Users\maxbl\Desktop`).
8. Total token count across the project table equals the total token count on the main KPI card (no events lost or duplicated).
9. Empty state: moving all vendor data aside and deleting any persistence file renders the `No project information yet.` line rather than an empty table or a crash.
