# Event Persistence — Design

**Date:** 2026-04-23
**Scope:** New `src/store.ts`, `src/index.ts`, `src/server.ts`
**Status:** Design approved, pending user review

## Context

Today every `tokenbbq` invocation re-scans the raw vendor directories of Claude Code, Codex, Gemini, OpenCode, Amp, and Pi-Agent via `loadAll()` in `src/index.ts`. Nothing is cached. If any vendor cleans up, rotates, or migrates their storage, the corresponding historical events are lost to TokenBBQ forever.

Observed risks:
- Gemini stores sessions under `~/.gemini/tmp/` — `tmp` is not just cosmetic; users report these disappearing.
- OpenCode has already migrated its storage format once (JSON files → SQLite), orphaning whatever historical loader data existed before. That migration is visible on the user's own machine.
- Codex sessions grow unbounded and users prune them.
- All tools may delete old sessions on upgrade, during cleanup, or when users run out of disk.

This spec introduces a local, append-only event store so TokenBBQ retains its historical view independent of vendor storage. After this change the store, not vendor data, is the source of truth for the dashboard and CLI.

## Decisions (locked)

### Storage format

**NDJSON file at `~/.tokenbbq/events.ndjson`.** One event per line. Append-only writes. Full read at startup.

Rationale: pure JavaScript (no native dependency), trivial crash-safety (single-line appends are atomic on POSIX and Windows for writes under 4 KB), easy to inspect and back up manually. SQLite was considered and rejected for v1 — the native-binary install cost outweighs the query-speed benefit at the data volumes expected (hundreds of thousands of events fit in a few MB).

If v1 grows into a bottleneck, migrating NDJSON → SQLite is a one-time offline conversion. Not a one-way door.

**Line format:**

```json
{"v":1,"source":"codex","timestamp":"2026-04-22T14:02:11.812Z","sessionId":"019cf17a-…","model":"gpt-5","tokens":{"input":120,"output":340,"cacheCreation":0,"cacheRead":0,"reasoning":0},"costUSD":0,"project":"Particulate","eventHash":"…"}
```

- `v` — schema version integer. Starts at `1`. Incremented when the line shape changes.
- All existing `UnifiedTokenEvent` fields (`source`, `timestamp`, `sessionId`, `model`, `tokens`, `costUSD`, `project`).
- `eventHash` — stable dedup key, see below.

### Store-is-truth model

The NDJSON store is the single source of truth for the dashboard and CLI. Vendor directories are scraped only to *feed* the store with new events. Vendor data disappearing never affects TokenBBQ's view.

**Startup flow:**

1. Load `~/.tokenbbq/events.ndjson` into memory. Create the file and parent directory if missing.
2. Scan vendor directories via `loadAll()` exactly as today.
3. For each scanned event, compute `eventHash`. If the hash is not already in the store's index, append the event to both the in-memory list and the NDJSON file.
4. Run `enrichCosts` on the in-memory list (so freshly-loaded historical events also get current pricing).
5. Aggregate from the in-memory list via `buildDashboardData`.
6. Serve dashboard / print CLI output.

**Auto-refresh:** the 5-second refresh in `server.ts` `reloadDashboardData` runs steps 2–5 (the store is already in memory from step 1). New events appear in the dashboard without a restart and are persisted to the NDJSON file in the same tick.

**First run:** the store file is missing → full vendor scan → every event written to the store. The user's complete known history is captured on first launch.

### Dedup

Each event gets a stable `eventHash` at ingest time:

```
sha256(source + "|" + sessionId + "|" + messageId + "|" + timestamp + "|" + tokens.input + "|" + tokens.output + "|" + tokens.cacheRead)
```

- For sources that expose a message ID (Claude Code via `requestId`/`messageId`, Gemini via `msg.id`, OpenCode via the SQLite `message.id`): `messageId` is the authoritative uniqueness component.
- For sources without a message ID (Codex): `messageId` is the empty string; `timestamp + tokens` carries the uniqueness. This matches what the current Codex in-run dedup already does implicitly via `subtractUsage`, which has not shown false-merge bugs in practice.

Hashes are stored in a `Set<string>` in memory on load for O(1) dedup during ingest.

The hash is stored on the line so that (a) the file can be validated/rebuilt without reprocessing events, and (b) future migration tools can detect duplicates across store versions.

### File management

**Location:** `~/.tokenbbq/events.ndjson`. Parent directory created with `0700` permissions if possible on POSIX; default ACL on Windows.

**Override:** `TOKENBBQ_DATA_DIR` environment variable, for tests and exotic setups. Matches the naming convention of the existing `CODEX_HOME`, `GEMINI_DIR`, `OPENCODE_DATA_DIR`, `AMP_DATA_DIR`, `PI_AGENT_DIR` overrides.

**Growth:** append-only, no automatic pruning in v1. An event is ~250 bytes of JSON; a heavy user producing 1000 events/day over 5 years ≈ 450 MB. Manageable, and pruning adds complexity not yet justified.

**Reset:** `rm ~/.tokenbbq/events.ndjson`. A dedicated `tokenbbq reset` CLI command is explicitly out of scope for v1. Users who need it can delete the file; the next run rebuilds from vendor data.

**Concurrent invocations:** two `tokenbbq` processes could race on append. Mitigation: (a) appends are short (single line, via `fs.appendFileSync` — atomic for writes under 4 KB on all supported platforms), (b) dedup is by content hash, so duplicate appends from a race are detected and filtered on the next read, (c) within a single server the refresh loop is serialized via the existing `refreshInFlight` promise in `server.ts`. The residual edge case (two processes append the same event in the same millisecond, producing one duplicate line) is accepted; it's visually invisible and self-heals on the next run.

**Corruption tolerance:** on read, each malformed JSON line is logged once and skipped. One bad line does not abort the load.

### Schema migration

The `v` field signals the schema version. Loader logic:

- `v === CURRENT_VERSION` — load as-is.
- `v < CURRENT_VERSION` — run in-memory migration on read. Migrated lines are not rewritten to disk in v1; rewriting the file is an operation deferred until we actually have a migration to do.
- `v > CURRENT_VERSION` — event was written by a newer TokenBBQ; skip with a warning rather than mis-interpret.
- `v` missing — treat as `v: 1` (for events written by very early builds before the field existed; applies only if such a build ever ships).

For v1 there is no migration code yet — the `v` field and skip-logic exist as the pattern placeholder.

## Architecture

**New module:** `src/store.ts`

```ts
export interface StoreState {
  events: UnifiedTokenEvent[];
  hashes: Set<string>;
  path: string;
}

export function loadStore(): StoreState;
export function appendEvents(state: StoreState, events: UnifiedTokenEvent[]): UnifiedTokenEvent[];
// ↑ returns the newly-appended subset, so callers can log "added N new events"

export function hashEvent(e: UnifiedTokenEvent): string;
export function getStoreDir(): string;  // honors TOKENBBQ_DATA_DIR
```

- `loadStore` reads the file line-by-line, parses, skips malformed/future-version lines with a single warning each, and deduplicates by `eventHash` while reading (so any duplicate lines left behind by a prior concurrent-write race are filtered out of the in-memory list). Returns the in-memory state.
- `appendEvents` filters events by hash, appends unknown ones to the NDJSON file via `fs.appendFileSync` (one write per batch), updates `state.events` and `state.hashes` in place.
- `hashEvent` is a pure function usable in tests.

**Modified:**

- `src/index.ts` — in `main()` and `reloadDashboardData`, the flow becomes: `const store = loadStore()` → `const { events: scanned } = await loadAll(...)` → `appendEvents(store, scanned)` → `await enrichCosts(store.events)` → `buildDashboardData(store.events)`.
- `src/server.ts` — `reloadDashboardData` now takes the store as a closure variable so it's loaded once per server lifecycle, not per refresh. The store is mutated in place on each refresh.
- `src/types.ts` — no changes. The persisted schema *is* the `UnifiedTokenEvent` shape plus `v` and `eventHash`, both of which are internal to the store module.

**Ordering invariant:** The store is read before vendor data is scanned. The merged list always contains all persisted events, never fewer.

## Non-goals

- No CLI command for managing the store (reset, export, compact, stats).
- No automatic pruning, archival, or compaction.
- No multi-machine sync. The store is per-user-per-machine.
- No encryption or access control beyond what the filesystem provides.
- No UI surface reporting cache-vs-fresh-scan statistics.
- No cloud backup, no Prometheus endpoint, no export to alternative formats.
- No migration code for the `v` field (the pattern exists; the first migration ships when needed).
- No SQLite backend. NDJSON is v1; SQLite is a possible v2 if data volume requires it.

## Testing

Manual verification on a machine with real vendor data.

1. **First run:** `rm -rf ~/.tokenbbq/` → `npx tokenbbq summary` → verify `~/.tokenbbq/events.ndjson` is created and its line count equals the event count of a cold scan.
2. **Second run, no new vendor events:** run again → verify file size and line count are unchanged, totals in the summary are identical.
3. **Second run with new vendor events:** create a new session in any tool → run → verify only the new events are appended, totals increase accordingly.
4. **Dedup correctness:** run the tool 10 times in quick succession → verify the file has not grown past the first run's content.
5. **Vendor data deletion simulation:** move `~/.codex/` aside → run → verify Codex events still appear in the dashboard, totals unchanged.
6. **Malformed line tolerance:** append a line of garbage to `~/.tokenbbq/events.ndjson` manually → run → verify the bad line is warned about and skipped, good lines still load, new events still append correctly.
7. **Future-version tolerance:** edit one line to have `"v":99` → run → verify it's skipped with a warning, rest of the events load normally, totals drop by exactly one.
8. **Auto-refresh:** start the dashboard, create a new session in any tool, wait 5+ seconds → verify the new event appears in the dashboard *and* has been appended to `~/.tokenbbq/events.ndjson`.
9. **Override path:** `TOKENBBQ_DATA_DIR=/tmp/tb-test npx tokenbbq summary` → verify store lands in `/tmp/tb-test/events.ndjson` and default `~/.tokenbbq/` is untouched.
10. **Concurrent runs:** start two servers (`--port=3000` and `--port=3001`) simultaneously against the same store → verify no crashes; a few duplicate lines may land in the file but the in-memory dedup in `loadStore` filters them on every subsequent start, so dashboard totals are always correct. v1 does not rewrite the file to remove the duplicate lines; they are harmless on disk.
