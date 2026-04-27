# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — run the CLI locally via tsx (`node --import tsx src/index.ts`)
- `npm run build` — bundle with tsdown into `dist/index.js` (ESM with a `#!/usr/bin/env node` banner; the rename step exists because npm's `bin` field points at `.js`, not `.mjs`)
- `npm run lint` — type-check only (`tsc --noEmit`); there is no ESLint
- `npm run test` — `node --test` (no test files currently exist; CI does not run this)
- `npm start` — run the built `dist/index.js`

Run a specific CLI subcommand during development: `npm run dev -- daily`, `npm run dev -- monthly`, `npm run dev -- summary`, or append flags like `-- --port=8080 --no-open --json`.

CI (`.github/workflows/ci.yml`) runs `npm run lint` and `npm run build` on Node 20/22/24. Keep both green — `package.json` sets `engines.node: ">=20"`.

## Architecture

TokenBBQ is a single-binary CLI that reads local usage files from several AI coding tools, normalizes them, prices them, aggregates them, and either prints tables or serves a live dashboard. All data stays on disk; the only network call is to LiteLLM for model prices.

The pipeline in `src/index.ts` is fixed: `loadAll` → `enrichCosts` → `buildDashboardData` → (CLI table | Hono server). Every stage operates on `UnifiedTokenEvent[]` or the derived `DashboardData` shape defined in `src/types.ts`; those types are the contract between layers.

### Loaders (`src/loaders/`)

Each supported tool has its own file; `loaders/index.ts` runs them in parallel via `Promise.allSettled` and merges successful results. A loader's job is to produce `UnifiedTokenEvent[]` and nothing else:

- Detect the tool's data directory (honor the tool-specific env override: `CLAUDE_CONFIG_DIR`, `GEMINI_DIR`, `OPENCODE_DATA_DIR`, `AMP_DATA_DIR`, `PI_AGENT_DIR`). Return `[]` when the directory is missing — never throw for "tool not installed".
- Normalize raw events into `UnifiedTokenEvent` (source, timestamp, sessionId, model, 5-field `TokenCounts`, costUSD, optional project). If the upstream format already carries a costUSD (e.g. Claude Code), preserve it; otherwise leave it `0` and let `pricing.ts` fill it in.
- Deduplicate within the loader when the upstream format can repeat entries; sort is handled globally in `loadAll`.

To add a new tool: create `src/loaders/<name>.ts`, register it in `LOADERS` (`loaders/index.ts`), extend the `Source` union in `types.ts`, and add matching entries to `SOURCE_LABELS` and `SOURCE_COLORS`. Those two maps are the single source of truth for the UI — missing entries will break the dashboard silently.

### Pricing (`src/pricing.ts`)

Fetches the LiteLLM price table once per process (5s timeout, falls back to a small inline `FALLBACK_PRICES` map on failure). `findModelPricing` tries several lookup strategies — exact match, common provider prefixes (`anthropic/`, `openai/`, `openrouter/openai/`), stripping `[pi]` prefix, stripping trailing date suffixes (`-YYYYMMDD`), and a fuzzy substring match. When adding a new loader whose model IDs don't already line up with LiteLLM keys, extend this function rather than rewriting the loader.

### Aggregator (`src/aggregator.ts`)

Pure function from `UnifiedTokenEvent[]` to `DashboardData`. Produces many pre-sliced views (daily, monthly, by-source, by-model, by-source-model, by-project, heatmap) because the dashboard is a static HTML render — there is no client-side aggregation. Sources in output lists are sorted by the fixed `SOURCE_ORDER` so chart colors stay stable across renders.

### Server + Dashboard (`src/server.ts`, `src/dashboard.ts`)

Hono app with three routes: `/` returns server-rendered HTML from `renderDashboard`, `/api/data` returns fresh `DashboardData` (polled every 5 seconds by the client for live refresh), and `/brand-logo` serves an optional PNG discovered via `TOKENBBQ_LOGO_PATH` or well-known Windows download paths. `readData` debounces reloads to at most once per 3 seconds and coalesces concurrent requests via `refreshInFlight`. `startServer` finds a free port in a 20-port window starting at the requested one.

## Repo layout notes

- `ccusage/`, `tokenbbq/`, and `landing/` are gitignored. `ccusage/` is the upstream reference repo we borrowed loader patterns from; `tokenbbq/` appears to be an older snapshot of this project. Do not edit them and do not treat their contents as authoritative — always work in `src/` at the repo root.
- `tsconfig.json` excludes `ccusage` from type-checking for the same reason; keep it excluded.
- TypeScript is strict ESM with `moduleResolution: bundler`. Internal imports must use the `.js` extension (e.g. `from './types.js'`) even though the sources are `.ts` — this is required for the built output and tsx honors it in dev.
