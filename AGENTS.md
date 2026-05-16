# Repository Guidelines

## Project Structure & Module Organization

TokenBBQ is a TypeScript ESM CLI and dashboard. Core source lives in `src/`: `index.ts` is the CLI entry point, `loaders/` normalizes usage data from supported tools, `aggregator.ts` prepares summaries, `pricing.ts` handles model pricing, and `server.ts`/`dashboard.ts` serve the web UI. Tests sit next to source as `*.test.ts`; loader fixtures live in `src/loaders/__fixtures__/`. Build helpers are in `scripts/`. The desktop widget is a separate Tauri/Vite app under `widget/`, with Rust backend code in `widget/src-tauri/` and frontend assets in `widget/src/`. Generated output belongs in `dist/`.

## Build, Test, and Development Commands

- `npm install`: install root dependencies.
- `npm run dev`: inline required assets, then run the CLI locally through `tsx`.
- `npm run lint`: run TypeScript type checking with `tsc --noEmit`.
- `npm run test`: run Node's test runner against `src/**/*.test.ts`.
- `npm run build`: produce the publishable CLI bundle in `dist/`.
- `npm run widget:install`: install widget dependencies.
- `npm run widget:dev`: build the sidecar and launch the Tauri widget.
- `npm run widget:build`: build the CLI, sidecar, and desktop widget package locally. Updater artifacts are disabled (via `widget/src-tauri/tauri.dev.conf.json`), so no signing key is needed.
- `npm run widget:build:release`: full signed build with updater artifacts. Requires `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); release CI builds this path via `tauri-action`.

## Coding Style & Naming Conventions

Use strict TypeScript, ESM `import`/`export`, and Node 20+ APIs. Keep module names lowercase and descriptive, for example `event-merge.ts` or `platform-paths.ts`. Tests should mirror the target module name, such as `pricing.test.ts`. Prefer small functions with explicit types at module boundaries. The codebase currently uses two-space indentation in TypeScript files; avoid unrelated formatting churn.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`, executed via `scripts/run-tests.mjs` so glob expansion works across supported Node versions. Add focused tests beside changed code when modifying aggregation, pricing, persistence, or loader behavior. For new loaders, include representative fixture data under `src/loaders/__fixtures__/` when practical and verify missing data directories return empty results rather than throwing.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style subjects, for example `fix(audit): ...`, `docs: ...`, and `chore(release): ...`. Keep subjects imperative and scoped when useful. Pull requests should fill out `.github/PULL_REQUEST_TEMPLATE.md`: explain what changed, why it is needed, confirm `npm run build`, note loader registration changes, and update `README.md` for user-facing behavior. Include screenshots or recordings for widget/dashboard UI changes.

## Security & Configuration Tips

Do not commit local usage databases, credentials, or generated `dist/` artifacts unless release packaging requires them. Preserve cross-platform path handling; CI runs Linux, macOS, and Windows.
