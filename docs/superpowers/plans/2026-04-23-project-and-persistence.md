# Project Tracking + Event Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two linked features in one pass: (1) per-project token tracking visible in a new dashboard section, (2) a persistent NDJSON event store that survives vendor cleanup. Both features share the loader layer, so they are implemented together to avoid touching loaders twice.

**Architecture:** A new `src/project.ts` resolves project roots from a `cwd` via filesystem markers. A new `src/store.ts` provides an append-only NDJSON event store at `~/.tokenbbq/events.ndjson` that becomes the dashboard's source of truth. Loaders are updated to emit project info and to feed the store. Dashboard gets a sortable project table between the heatmap and the daily breakdown.

**Tech Stack:** TypeScript, Node ≥20, ESM, `node --test` runner with `tsx` for TS, `sql.js` for reading OpenCode's SQLite DB, existing `hono`/`tinyglobby`/`picocolors`/`cli-table3` dependencies.

**Related specs:**
- `docs/superpowers/specs/2026-04-23-project-tracking-design.md`
- `docs/superpowers/specs/2026-04-23-event-persistence-design.md`

---

## Task 0: Bootstrap the test runner

**Why:** The project has no tests yet. Before writing TDD tasks, we need `npm test` to actually execute TS test files.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update the `test` script to run TS tests via `tsx`**

Replace the `"test": "node --test"` line in `package.json` with:

```json
"test": "node --test --import tsx \"src/**/*.test.ts\""
```

- [ ] **Step 2: Create a smoke test to confirm the runner works**

Create `src/smoke.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner is wired up', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: `pass 1`, `fail 0`.

- [ ] **Step 4: Delete the smoke test**

```bash
rm src/smoke.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: wire node --test runner with tsx for TS test files"
```

---

## Task 1: Project root resolver (`src/project.ts`)

**Why:** Every path-based loader needs the same walk-up-until-marker logic. Centralize it so they behave identically.

**Files:**
- Create: `src/project.ts`
- Create: `src/project.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/project.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { resolveProjectRoot } from './project.js';

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'tbq-proj-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    mkdir: (rel: string) => {
      mkdirSync(path.join(root, rel), { recursive: true });
      return path.join(root, rel);
    },
    touch: (rel: string) => {
      writeFileSync(path.join(root, rel), '');
    },
  };
}

describe('resolveProjectRoot', () => {
  test('returns cwd itself when no markers exist anywhere', () => {
    const fx = makeFixture();
    try {
      const dir = fx.mkdir('a/b/c');
      const res = resolveProjectRoot(dir);
      assert.equal(res.root, dir);
      assert.equal(res.name, 'c');
    } finally { fx.cleanup(); }
  });

  test('walks up to directory with .git', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('myproj/src/nested');
      fx.mkdir('myproj/.git');
      const res = resolveProjectRoot(deep);
      assert.equal(res.root, path.join(fx.root, 'myproj'));
      assert.equal(res.name, 'myproj');
    } finally { fx.cleanup(); }
  });

  test('walks up to directory with package.json (no git)', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('myproj/lib/x');
      fx.touch('myproj/package.json');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'myproj');
    } finally { fx.cleanup(); }
  });

  test('any marker works — README.md counts', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('myproj/sub');
      fx.touch('myproj/README.md');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'myproj');
    } finally { fx.cleanup(); }
  });

  test('first marker wins — stops at nearest ancestor with any marker', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('outer/inner/sub');
      fx.mkdir('outer/.git');
      fx.touch('outer/inner/package.json');
      const res = resolveProjectRoot(deep);
      assert.equal(res.name, 'inner');
    } finally { fx.cleanup(); }
  });

  test('stops at $HOME boundary', () => {
    const home = homedir();
    const res = resolveProjectRoot(home);
    assert.equal(res.root, home);
    assert.equal(res.name, path.basename(home));
  });

  test('returns the same result when called twice with same cwd (cached)', () => {
    const fx = makeFixture();
    try {
      const deep = fx.mkdir('p/q');
      fx.touch('p/README.md');
      const a = resolveProjectRoot(deep);
      const b = resolveProjectRoot(deep);
      assert.equal(a.root, b.root);
      assert.equal(a.name, b.name);
    } finally { fx.cleanup(); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './project.js'` (or similar).

- [ ] **Step 3: Implement `src/project.ts`**

Create `src/project.ts`:

```ts
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const MARKERS = [
  '.git', '.hg', '.svn',
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml',
  'README.md', '.gitignore', 'CHANGELOG.md',
];

const CSPROJ_RE = /\.csproj$/i;

function hasMarker(dir: string): boolean {
  for (const m of MARKERS) {
    if (existsSync(path.join(dir, m))) return true;
  }
  try {
    // cheap fallback check for *.csproj — only attempt if dir is readable
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const entries = readdirSync(dir);
    for (const e of entries) {
      if (CSPROJ_RE.test(e)) return true;
    }
  } catch {
    // ignore — directory unreadable, treat as "no marker"
  }
  return false;
}

const cache = new Map<string, { root: string; name: string }>();

export function resolveProjectRoot(cwd: string): { root: string; name: string } {
  const normalized = path.resolve(cwd);
  const cached = cache.get(normalized);
  if (cached) return cached;

  const home = path.resolve(homedir());
  const parsed = path.parse(normalized);
  const driveRoot = parsed.root;

  let current = normalized;
  // Walk up until a marker is found, or we hit $HOME / drive root.
  // Safety: never ascend above $HOME or above the drive root.
  while (true) {
    try {
      if (statSync(current).isDirectory() && hasMarker(current)) break;
    } catch {
      // current does not exist or is unreadable — fall through, stop walking
      break;
    }

    if (current === home || current === driveRoot) break;

    const parent = path.dirname(current);
    if (parent === current) break;  // belt and suspenders
    current = parent;
  }

  const result = { root: current, name: path.basename(current) || current };
  cache.set(normalized, result);
  return result;
}

// Exposed for tests only.
export function __resetProjectCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/project.ts src/project.test.ts
git commit -m "feat(project): add resolveProjectRoot helper with marker-based walk-up"
```

---

## Task 2: NDJSON event store (`src/store.ts`)

**Why:** Core of the persistence feature. Must be TDD-solid since the whole dashboard will depend on it.

**Files:**
- Create: `src/store.ts`
- Create: `src/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store.test.ts`:

```ts
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadStore, appendEvents, hashEvent, getStoreDir } from './store.js';
import type { UnifiedTokenEvent } from './types.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'tbq-store-'));
  process.env.TOKENBBQ_DATA_DIR = tmp;
});
afterEach(() => {
  delete process.env.TOKENBBQ_DATA_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

function ev(over: Partial<UnifiedTokenEvent> = {}): UnifiedTokenEvent {
  return {
    source: 'codex',
    timestamp: '2026-04-22T14:02:11.812Z',
    sessionId: 's1',
    model: 'gpt-5',
    tokens: { input: 100, output: 200, cacheCreation: 0, cacheRead: 50, reasoning: 0 },
    costUSD: 0,
    ...over,
  };
}

describe('hashEvent', () => {
  test('is deterministic', () => {
    assert.equal(hashEvent(ev()), hashEvent(ev()));
  });
  test('changes when timestamp changes', () => {
    assert.notEqual(hashEvent(ev()), hashEvent(ev({ timestamp: '2026-04-22T14:02:12.000Z' })));
  });
  test('changes when source changes', () => {
    assert.notEqual(hashEvent(ev()), hashEvent(ev({ source: 'claude-code' })));
  });
});

describe('getStoreDir', () => {
  test('honors TOKENBBQ_DATA_DIR', () => {
    assert.equal(getStoreDir(), tmp);
  });
});

describe('loadStore', () => {
  test('returns empty state when file is missing', () => {
    const state = loadStore();
    assert.equal(state.events.length, 0);
    assert.equal(state.hashes.size, 0);
    assert.equal(state.path, path.join(tmp, 'events.ndjson'));
    assert.ok(existsSync(path.join(tmp, 'events.ndjson')));
  });

  test('reads existing NDJSON file and dedups duplicates on load', () => {
    const e = ev();
    const h = hashEvent(e);
    const line = JSON.stringify({ v: 1, ...e, eventHash: h }) + '\n';
    appendFileSync(path.join(tmp, 'events.ndjson'), line + line + line);

    const state = loadStore();
    assert.equal(state.events.length, 1);
    assert.equal(state.hashes.size, 1);
  });

  test('skips malformed lines and future-version lines', () => {
    const e = ev();
    const good = JSON.stringify({ v: 1, ...e, eventHash: hashEvent(e) }) + '\n';
    const future = JSON.stringify({ v: 99, ...e, eventHash: 'x' }) + '\n';
    const bad = 'not json\n';
    appendFileSync(path.join(tmp, 'events.ndjson'), good + future + bad);

    const state = loadStore();
    assert.equal(state.events.length, 1);
  });
});

describe('appendEvents', () => {
  test('appends new events and returns the new subset', () => {
    const state = loadStore();
    const e1 = ev({ sessionId: 's1' });
    const e2 = ev({ sessionId: 's2' });
    const added = appendEvents(state, [e1, e2]);
    assert.equal(added.length, 2);
    assert.equal(state.events.length, 2);

    const reread = loadStore();
    assert.equal(reread.events.length, 2);
  });

  test('filters duplicates', () => {
    const state = loadStore();
    const e = ev();
    appendEvents(state, [e]);
    const added = appendEvents(state, [e, e, e]);
    assert.equal(added.length, 0);
    assert.equal(state.events.length, 1);
  });

  test('persists the eventHash and v field on disk', () => {
    const state = loadStore();
    appendEvents(state, [ev()]);
    const line = readFileSync(path.join(tmp, 'events.ndjson'), 'utf-8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.v, 1);
    assert.ok(typeof parsed.eventHash === 'string' && parsed.eventHash.length > 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './store.js'`.

- [ ] **Step 3: Implement `src/store.ts`**

Create `src/store.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import type { UnifiedTokenEvent } from './types.js';

const CURRENT_VERSION = 1;

export interface StoreState {
  events: UnifiedTokenEvent[];
  hashes: Set<string>;
  path: string;
}

export function getStoreDir(): string {
  const override = (process.env.TOKENBBQ_DATA_DIR ?? '').trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), '.tokenbbq');
}

function storeFilePath(): string {
  return path.join(getStoreDir(), 'events.ndjson');
}

export function hashEvent(e: UnifiedTokenEvent): string {
  const payload = [
    e.source,
    e.sessionId,
    e.timestamp,
    e.model,
    e.tokens.input,
    e.tokens.output,
    e.tokens.cacheRead,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

export function loadStore(): StoreState {
  const dir = getStoreDir();
  const file = storeFilePath();

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) {
    appendFileSync(file, '');
    return { events: [], hashes: new Set(), path: file };
  }

  const raw = readFileSync(file, 'utf-8');
  const events: UnifiedTokenEvent[] = [];
  const hashes = new Set<string>();

  let badSeen = 0;
  let futureSeen = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      badSeen++;
      continue;
    }

    const v = typeof parsed.v === 'number' ? parsed.v : 1;
    if (v > CURRENT_VERSION) {
      futureSeen++;
      continue;
    }

    const hash = typeof parsed.eventHash === 'string' ? parsed.eventHash : null;
    if (!hash || hashes.has(hash)) continue;

    hashes.add(hash);
    events.push({
      source: parsed.source as UnifiedTokenEvent['source'],
      timestamp: parsed.timestamp as string,
      sessionId: parsed.sessionId as string,
      model: parsed.model as string,
      tokens: parsed.tokens as UnifiedTokenEvent['tokens'],
      costUSD: typeof parsed.costUSD === 'number' ? parsed.costUSD : 0,
      project: typeof parsed.project === 'string' ? parsed.project : undefined,
    });
  }

  if (badSeen > 0) console.warn(`tokenbbq: skipped ${badSeen} malformed line(s) in store`);
  if (futureSeen > 0) console.warn(`tokenbbq: skipped ${futureSeen} line(s) with future schema version`);

  return { events, hashes, path: file };
}

export function appendEvents(state: StoreState, events: UnifiedTokenEvent[]): UnifiedTokenEvent[] {
  const added: UnifiedTokenEvent[] = [];
  let buffer = '';

  for (const e of events) {
    const hash = hashEvent(e);
    if (state.hashes.has(hash)) continue;
    state.hashes.add(hash);
    state.events.push(e);
    added.push(e);
    buffer += JSON.stringify({ v: CURRENT_VERSION, ...e, eventHash: hash }) + '\n';
  }

  if (buffer) appendFileSync(state.path, buffer);
  return added;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all previous tests still pass, plus 9 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts
git commit -m "feat(store): add NDJSON event store with hash-based dedup"
```

---

## Task 3: Extend `ProjectAggregation` type and `aggregateByProject`

**Why:** The UI table needs `projectPath` (for collision disambiguation internally) and `lastActive` (for the "Last Active" column).

**Files:**
- Modify: `src/types.ts`
- Modify: `src/aggregator.ts`
- Create: `src/aggregator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/aggregator.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByProject } from './aggregator.js';
import type { UnifiedTokenEvent } from './types.js';

function ev(over: Partial<UnifiedTokenEvent> = {}): UnifiedTokenEvent {
  return {
    source: 'claude-code',
    timestamp: '2026-04-20T10:00:00.000Z',
    sessionId: 's',
    model: 'claude-opus-4-7',
    tokens: { input: 100, output: 200, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
    costUSD: 0.5,
    ...over,
  };
}

describe('aggregateByProject', () => {
  test('groups events by project and computes lastActive as latest event date', () => {
    const events = [
      ev({ project: 'TokenBBQ', timestamp: '2026-04-20T10:00:00.000Z' }),
      ev({ project: 'TokenBBQ', timestamp: '2026-04-22T12:00:00.000Z' }),
      ev({ project: 'Particulate', timestamp: '2026-04-21T10:00:00.000Z' }),
    ];
    const out = aggregateByProject(events);
    const tbq = out.find(p => p.project === 'TokenBBQ');
    const part = out.find(p => p.project === 'Particulate');
    assert.ok(tbq && part);
    assert.equal(tbq.lastActive, '2026-04-22');
    assert.equal(part.lastActive, '2026-04-21');
    assert.equal(tbq.eventCount, 2);
  });

  test('sets projectPath equal to project (display name) when no path distinction', () => {
    const out = aggregateByProject([ev({ project: 'X' })]);
    assert.equal(out[0].projectPath, 'X');
  });

  test('events without project are excluded', () => {
    const out = aggregateByProject([ev({ project: undefined })]);
    assert.equal(out.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `lastActive` is undefined on the aggregation.

- [ ] **Step 3: Update `src/types.ts`**

In `src/types.ts`, replace the `ProjectAggregation` interface (around line 95):

```ts
export interface ProjectAggregation {
  project: string;
  projectPath: string;
  tokens: TokenCounts;
  costUSD: number;
  sources: Source[];
  eventCount: number;
  lastActive: string;  // YYYY-MM-DD of latest event
}
```

- [ ] **Step 4: Update `aggregateByProject` in `src/aggregator.ts`**

Replace the existing `aggregateByProject` function (lines 245–274) with:

```ts
export function aggregateByProject(events: UnifiedTokenEvent[]): ProjectAggregation[] {
  const map = new Map<string, ProjectAggregation>();

  for (const e of events) {
    const project = typeof e.project === 'string' ? e.project.trim() : '';
    if (!project || project.toLowerCase() === 'unknown') continue;

    let agg = map.get(project);
    if (!agg) {
      agg = {
        project,
        projectPath: project,
        tokens: emptyTokens(),
        costUSD: 0,
        sources: [],
        eventCount: 0,
        lastActive: e.timestamp.slice(0, 10),
      };
      map.set(project, agg);
    }
    agg.tokens = addTokens(agg.tokens, e.tokens);
    agg.costUSD += e.costUSD;
    agg.sources.push(e.source);
    agg.eventCount++;
    const date = e.timestamp.slice(0, 10);
    if (date > agg.lastActive) agg.lastActive = date;
  }

  for (const agg of map.values()) {
    agg.sources = sortSources(unique(agg.sources) as Source[]);
  }

  return [...map.values()].sort((a, b) => {
    const tokenDiff = totalTokenCount(b.tokens) - totalTokenCount(a.tokens);
    if (tokenDiff !== 0) return tokenDiff;
    return a.project.localeCompare(b.project);
  });
}
```

Also remove the now-unused helper `normalizedProjectName` (lines 48–53) and ensure `totalTokenCount` is in the existing imports (it is — line 16).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all previous tests still pass, plus 3 new tests.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/aggregator.ts src/aggregator.test.ts
git commit -m "feat(aggregator): add projectPath and lastActive to ProjectAggregation, sort by tokens"
```

---

## Task 4: Claude loader — extract project from per-line `cwd`

**Why:** The current loader derives project from URL-encoded folder names, which lose spaces and umlauts. Every JSONL line already contains a clean `cwd`.

**Files:**
- Modify: `src/loaders/claude.ts`

- [ ] **Step 1: Inspect the current state of `src/loaders/claude.ts`**

Open the file and find the per-line loop (around lines 75–110). Note that `parseLine(parsed)` returns the event, and the loader currently sets `event.project = project` where `project` is derived from the folder name.

- [ ] **Step 2: Replace the project-derivation logic**

In `src/loaders/claude.ts`, at the top add:

```ts
import { resolveProjectRoot } from '../project.js';
```

Then inside the per-file loop, remove the folder-name derivation:

```ts
// REMOVE:
const relPath = path.relative(projectsDir, file);
const parts = relPath.split(path.sep);
const project = parts.length >= 2 ? parts.slice(0, -1).join('/') : 'unknown';
```

And inside the per-line loop, replace `event.project = project;` with:

```ts
const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : undefined;
if (cwd) {
  event.project = resolveProjectRoot(cwd).name;
}
// No fallback: if no cwd is present on any line, event.project stays undefined.
```

- [ ] **Step 3: Run the existing tests to make sure nothing regressed**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 4: Manual smoke check against real Claude data**

Run:

```bash
npm run dev -- --json | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(d.byProject.slice(0,5).map(p => p.project));"
```

Expected: the list contains bare directory names like `TokenBBQ`, not `C--Users-maxbl-Desktop-Projekte-TokenBBQ`.

- [ ] **Step 5: Commit**

```bash
git add src/loaders/claude.ts
git commit -m "feat(loader/claude): derive project from per-line cwd via resolveProjectRoot"
```

---

## Task 5: Codex loader — extract project from `session_meta`

**Why:** The Codex loader currently sets no project at all. Every session file's first line is a `session_meta` entry containing `cwd`.

**Files:**
- Modify: `src/loaders/codex.ts`

- [ ] **Step 1: Add the import and per-session state**

In `src/loaders/codex.ts`, add at the top:

```ts
import { resolveProjectRoot } from '../project.js';
```

- [ ] **Step 2: Capture `cwd` from `session_meta`, apply to every event**

Find the per-session loop (around line 77). Just inside `for (const file of files) { ... }`, after `let currentModel: string | undefined;`, add:

```ts
let sessionProject: string | undefined;
```

Inside the per-line parsing, add a new branch for `session_meta` (just before the `turn_context` branch):

```ts
if (entryType === 'session_meta') {
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined;
  if (cwd) sessionProject = resolveProjectRoot(cwd).name;
  continue;
}
```

Inside the `events.push({...})` call at the bottom of the loop, add `project: sessionProject` as a field:

```ts
events.push({
  source: 'codex',
  timestamp,
  sessionId,
  model,
  tokens: { /* unchanged */ },
  costUSD: 0,
  project: sessionProject,
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 4: Manual smoke check**

Run:

```bash
npm run dev -- --json | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(d.byProject.filter(p => p.sources.includes('codex')).slice(0,5).map(p => p.project));"
```

Expected: non-empty list of bare names like `Particulate`, `TokenBBQ`, etc.

- [ ] **Step 5: Commit**

```bash
git add src/loaders/codex.ts
git commit -m "feat(loader/codex): extract project from session_meta cwd"
```

---

## Task 6: OpenCode loader — rewrite against SQLite via `sql.js`

**Why:** The existing OpenCode loader reads `storage/message/*.json`. Modern OpenCode uses a SQLite DB at `~/.local/share/opencode/opencode.db`, so the current loader produces zero events. We rewrite it and add project support in the same pass.

**Files:**
- Modify: `src/loaders/opencode.ts`
- Modify: `package.json` (add `sql.js`)

- [ ] **Step 1: Install `sql.js` and its type package**

Run:

```bash
npm install sql.js
npm install --save-dev @types/sql.js
```

- [ ] **Step 2: Replace `src/loaders/opencode.ts` entirely**

Overwrite `src/loaders/opencode.ts` with:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { UnifiedTokenEvent } from '../types.js';
import { resolveProjectRoot } from '../project.js';

const HOME = homedir();

function getOpenCodeDir(): string | null {
  const envPath = (process.env.OPENCODE_DATA_DIR ?? '').trim();
  if (envPath !== '') {
    const resolved = path.resolve(envPath);
    if (existsSync(path.join(resolved, 'opencode.db'))) return resolved;
  }
  const defaultPath = path.join(HOME, '.local', 'share', 'opencode');
  if (existsSync(path.join(defaultPath, 'opencode.db'))) return defaultPath;
  return null;
}

interface ProjectRow { id: string; worktree: string }
interface SessionRow { id: string; project_id: string; directory: string }

export async function loadOpenCodeEvents(): Promise<UnifiedTokenEvent[]> {
  const dir = getOpenCodeDir();
  if (!dir) return [];
  const dbFile = path.join(dir, 'opencode.db');

  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  try {
    SQL = await initSqlJs();
  } catch (err) {
    console.warn('tokenbbq: failed to initialize sql.js for OpenCode loader:', err);
    return [];
  }

  let db: InstanceType<typeof SQL.Database>;
  try {
    const buffer = readFileSync(dbFile);
    db = new SQL.Database(new Uint8Array(buffer));
  } catch (err) {
    console.warn('tokenbbq: failed to open OpenCode DB:', err);
    return [];
  }

  const events: UnifiedTokenEvent[] = [];

  try {
    // Build project_id -> worktree lookup
    const projects = new Map<string, string>();
    const projStmt = db.prepare('SELECT id, worktree FROM project');
    while (projStmt.step()) {
      const row = projStmt.getAsObject() as unknown as ProjectRow;
      projects.set(row.id, row.worktree ?? '');
    }
    projStmt.free();

    // Build session_id -> cwd
    const sessions = new Map<string, string>();
    const sessStmt = db.prepare('SELECT id, project_id, directory FROM session');
    while (sessStmt.step()) {
      const row = sessStmt.getAsObject() as unknown as SessionRow;
      const cwd = row.directory && row.directory.trim()
        ? row.directory
        : projects.get(row.project_id) ?? '';
      sessions.set(row.id, cwd);
    }
    sessStmt.free();

    // Iterate assistant messages with usage info
    const msgStmt = db.prepare('SELECT id, session_id, time_created, data FROM message');
    while (msgStmt.step()) {
      const row = msgStmt.getAsObject() as unknown as { id: string; session_id: string; time_created: number; data: string };
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.data);
      } catch {
        continue;
      }

      if (payload.role !== 'assistant') continue;

      const tokens = payload.tokens as Record<string, unknown> | undefined;
      if (!tokens) continue;

      const input = numberOr(tokens.input, 0);
      const output = numberOr(tokens.output, 0);
      const reasoning = numberOr(tokens.reasoning, 0);
      const cache = (tokens.cache ?? {}) as Record<string, unknown>;
      const cacheRead = numberOr(cache.read, 0);
      const cacheCreation = numberOr(cache.write, 0);

      if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0 && reasoning === 0) continue;

      const time = payload.time as Record<string, unknown> | undefined;
      const timestampMs = numberOr(time?.created, row.time_created);
      const timestamp = new Date(timestampMs).toISOString();

      const modelID = typeof payload.modelID === 'string' ? payload.modelID : 'unknown';

      const cwd = sessions.get(row.session_id) ?? '';
      const project = cwd ? resolveProjectRoot(cwd).name : undefined;

      events.push({
        source: 'opencode',
        timestamp,
        sessionId: row.session_id,
        model: modelID,
        tokens: { input, output, cacheCreation, cacheRead, reasoning },
        costUSD: 0,
        project,
      });
    }
    msgStmt.free();
  } finally {
    db.close();
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return events;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
```

- [ ] **Step 3: Verify the loader is still called from `src/loaders/index.ts`**

Open `src/loaders/index.ts` and confirm `loadOpenCodeEvents` is imported and called. Name did not change, no edits needed. If it did change for any reason, update the import there.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 5: Manual smoke check against real OpenCode data**

Run:

```bash
npm run dev -- --json | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log('opencode events:', d.bySource.find(s => s.source==='opencode')?.eventCount ?? 0);"
```

Expected: a non-zero event count (was 0 before this task on the user's machine).

- [ ] **Step 6: Commit**

```bash
git add src/loaders/opencode.ts package.json package-lock.json
git commit -m "feat(loader/opencode): rewrite against SQLite via sql.js, emit project"
```

---

## Task 7: Wire the store into startup and refresh flows

**Why:** Dashboard and CLI must read from the store, not directly from the scanner output. This is what makes vendor-data-deletion survivable.

**Files:**
- Modify: `src/index.ts`

Design note: the store is loaded **once** per process and mutated in place on each refresh. `reloadDashboardData` is converted to a closure created inside `main()` that closes over the store. No edits to `src/server.ts` are needed because it already takes `getData` as an opaque callback.

- [ ] **Step 1: Update `src/index.ts`**

In `src/index.ts`, add imports at the top:

```ts
import { loadStore, appendEvents, type StoreState } from './store.js';
```

Delete the existing top-level `async function reloadDashboardData(): ...` (lines 67–74). It will be replaced by a closure inside `main`.

Replace the event-loading block inside `main` — from `const { events, detected, errors } = await loadAll(json);` through to the call to `await startServer(data, ...)` — with this structure:

```ts
const store: StoreState = loadStore();
const { events: scanned, detected } = await loadAll(json);
const added = appendEvents(store, scanned);

if (store.events.length === 0) {
  console.error(pc.yellow('\n  No usage data found.'));
  console.error(pc.dim('  Make sure you have used at least one supported AI coding tool.'));
  console.error(pc.dim('  Run `npx tokenbbq --help` for supported tool paths.\n'));
  return;
}

log(pc.dim(`\n  Total: ${store.events.length.toLocaleString()} events in store (+ ${added.length} new from ${detected.length} source(s))\n`));
log(pc.dim('  Calculating costs...'));
await enrichCosts(store.events);

const data = buildDashboardData(store.events);

if (json) {
  process.stdout.write(JSON.stringify(data, null, 2));
  return;
}

const reloadDashboardData = async () => {
  const { events: fresh } = await loadAll(true);
  appendEvents(store, fresh);
  await enrichCosts(store.events);
  return buildDashboardData(store.events);
};

switch (command) {
  case 'daily':
    printSummary(data);
    printDailyTable(data);
    break;
  case 'monthly':
    printSummary(data);
    printMonthlyTable(data);
    break;
  case 'summary':
    printSummary(data);
    break;
  case 'dashboard':
  default:
    printSummary(data);
    await startServer(data, {
      port,
      open: !noOpen,
      getData: reloadDashboardData,
      brandLogoPath: getDashboardBrandLogoPath(),
    });
    break;
}
```

Replace the existing `switch (command)` block at the bottom of `main` with nothing — the switch is now inline above.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all previous tests still pass.

- [ ] **Step 3: Manual full-run smoke check (first run)**

Run:

```bash
rm -rf ~/.tokenbbq
npm run dev -- summary
```

Expected: output shows non-zero totals, AND `~/.tokenbbq/events.ndjson` exists with one line per event.

- [ ] **Step 4: Manual smoke check (second run — dedup)**

Run:

```bash
LINES_BEFORE=$(wc -l < ~/.tokenbbq/events.ndjson)
npm run dev -- summary
LINES_AFTER=$(wc -l < ~/.tokenbbq/events.ndjson)
echo "before=$LINES_BEFORE after=$LINES_AFTER"
```

Expected: `before` equals `after` (no duplicates appended).

- [ ] **Step 5: Manual smoke check (vendor-data-gone survives)**

Run:

```bash
mv ~/.codex ~/.codex.bak
npm run dev -- --json | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log('codex events after hiding ~/.codex:', d.bySource.find(s => s.source==='codex')?.eventCount ?? 0);"
mv ~/.codex.bak ~/.codex
```

Expected: the codex event count is still > 0 — the store preserved the historical events.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat(persistence): make NDJSON store the source of truth for dashboard and CLI"
```

---

## Task 8: Dashboard UI — new project table section

**Why:** Final user-visible output. Sits between the Activity Heatmap and the Daily Breakdown table, matching the client-side-rendered pattern of the existing tables.

**Heads-up:** `src/dashboard.ts` is also being edited on branch `feat/tokens-focus-and-popup-rebuild` (the dashboard-improvements work). This task will conflict with that branch. Resolve by placing the new `<div id="chart-projects">` block verbatim between heatmap and daily breakdown on whichever branch lands second.

**Files:**
- Modify: `src/dashboard.ts`

### Step 1 — Add the card HTML between heatmap and daily breakdown

- [ ] **Step 1: Insert the Projects card**

In `src/dashboard.ts`, between the Activity Heatmap `</div>` (currently at **line 295**, closing the `<div id="chart-heatmap">` block that opens at line 292) and the `<!-- Daily Table -->` comment (currently at **line 297**), insert:

```html
  <!-- Projects -->
  <div id="chart-projects" class="bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5 mb-4">
    <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900 mb-4">Projects</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-border dark:border-border light:border-light-border">
            <th class="text-left py-2 px-3 sort-btn" data-proj-sort="project">Project</th>
            <th class="text-left py-2 px-3">Providers</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="tokens">Tokens</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="cost">Cost</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="events">Events</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="last">Last Active</th>
          </tr>
        </thead>
        <tbody id="projectsTableBody"></tbody>
      </table>
    </div>
  </div>
```

Note the distinct `data-proj-sort` attribute (not `data-sort`) — this namespaces the sort state so it doesn't collide with the Daily Breakdown's `.sort-btn` handlers.

### Step 2 — Add client-side rendering

- [ ] **Step 2: Add state, renderer, and click handler in the embedded script**

In the embedded script block of `src/dashboard.ts`, add the following alongside the other client-side render functions. The existing `currentSort` state object is used by `renderTable`; we introduce a parallel `currentProjSort`.

Near the top of the embedded script (alongside the existing `let currentSort = ...` definition — find it by searching for `currentSort`), add:

```js
let currentProjSort = { key: 'tokens', dir: 'desc' };
```

Alongside the existing `renderTable` function (around line 928), add:

```js
function totalProjectTokens(p) {
  const t = p.tokens || {};
  return (t.input || 0) + (t.output || 0) + (t.cacheCreation || 0) + (t.cacheRead || 0) + (t.reasoning || 0);
}

function renderProjects(data) {
  const tbody = document.getElementById('projectsTableBody');
  tbody.innerHTML = '';

  const rows = (data.byProject || []).slice();
  const dir = currentProjSort.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    switch (currentProjSort.key) {
      case 'project': return dir * a.project.localeCompare(b.project);
      case 'tokens':  return dir * (totalProjectTokens(a) - totalProjectTokens(b));
      case 'cost':    return dir * (a.costUSD - b.costUSD);
      case 'events':  return dir * (a.eventCount - b.eventCount);
      case 'last':    return dir * a.lastActive.localeCompare(b.lastActive);
      default:        return 0;
    }
  });

  document.querySelectorAll('[data-proj-sort]').forEach(btn => {
    btn.classList.remove('sort-asc', 'sort-desc');
    if (btn.dataset.projSort === currentProjSort.key) {
      btn.classList.add(currentProjSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" class="py-4 px-3 text-center text-gray-500">No project information yet.</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const p of rows) {
    const chips = p.sources.map(s =>
      '<span class="inline-block px-1.5 py-0.5 rounded text-xs" style="background:' +
      SOURCE_COLORS[s] + '22;color:' + SOURCE_COLORS[s] + '">' +
      (SOURCE_LABELS[s] || s) + '</span>'
    ).join(' ');

    const tr = document.createElement('tr');
    tr.className = 'border-b border-border/50 hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-gray-100 transition-colors';
    tr.innerHTML =
      '<td class="py-2 px-3 text-gray-200 dark:text-gray-200 light:text-gray-800">' + escapeHtml(p.project) + '</td>' +
      '<td class="py-2 px-3">' + chips + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(totalProjectTokens(p)) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmtUSD(p.costUSD) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(p.eventCount) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-400 dark:text-gray-400 light:text-gray-600">' + p.lastActive + '</td>';
    tbody.appendChild(tr);
  }
}
```

If `escapeHtml` is not already defined in the embedded script, add it next to `renderProjects`:

```js
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
```

(Search the existing script for `escapeHtml` first — if it exists, reuse it.)

### Step 3 — Hook the renderer into the main render pipeline

- [ ] **Step 3: Call `renderProjects(data)` alongside the other renders**

Find the call site where `renderHeatmap(data)` and `renderTable(data)` are invoked inside the main render loop (the existing line 699 is `renderHeatmap(data);`, and `renderTable(data)` is called nearby). Add:

```js
renderProjects(data);
```

On its own line, immediately after `renderHeatmap(data);`.

### Step 4 — Add click handlers for the new sort buttons

- [ ] **Step 4: Wire sort-on-header clicks for the projects table**

Find the existing sort-button click binding (search for `.sort-btn` selector in the embedded script — it's the handler that toggles `currentSort`). Next to it, add a parallel binding:

```js
document.querySelectorAll('[data-proj-sort]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.projSort;
    if (currentProjSort.key === key) {
      currentProjSort.dir = currentProjSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      currentProjSort.key = key;
      currentProjSort.dir = key === 'project' ? 'asc' : 'desc';
    }
    renderProjects(window.__latestData || DATA);
  });
});
```

Note: the handler references `window.__latestData` as the "current data after time-window filtering". Inspect the existing render loop — if there is a variable that already holds the filtered dataset (look for where `renderTable(data)` receives `data`), use that. If the simplest path is to stash the latest filtered data on `window` just after the render loop, do so: `window.__latestData = data;` right before the `renderProjects(data);` call.

### Step 5 — Build and verify

- [ ] **Step 5: Build and run**

```bash
npm run build
rm -rf ~/.tokenbbq
npm start -- --no-open --port=3737 &
sleep 3
```

Open `http://localhost:3737`.

Expected:
- A "Projects" card exists between the Activity heatmap and the Daily Breakdown.
- Rows are sorted by Tokens descending by default.
- Project names are bare (e.g. `TokenBBQ`, not `C--Users-maxbl-Desktop-Projekte-TokenBBQ`).
- Each row has colored provider chips matching `SOURCE_COLORS`.
- Clicking any sortable header cycles asc/desc.
- If no projects exist at all: the single row "No project information yet." is shown.

Kill the server:

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all tests still pass (this task only touched `dashboard.ts`, which has no unit tests).

- [ ] **Step 7: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat(dashboard): add Projects table between heatmap and daily breakdown"
```

---

## Task 9: End-to-end verification

**Why:** Lock in that both features work together on real user data before declaring done.

**Files:** none (verification only).

- [ ] **Step 1: Clean slate**

```bash
rm -rf ~/.tokenbbq
```

- [ ] **Step 2: Cold start — full import from vendors into the store**

Run:

```bash
npm run build
npm start -- --no-open --port=3737 &
sleep 3
```

Open browser → `http://localhost:3737`. Verify:

- Totals on the KPI cards match what you'd expect.
- The "Projects" section exists between heatmap and daily breakdown.
- Claude Code events show under bare-name projects (e.g. `TokenBBQ`, not URL-encoded).
- Codex events show project names (e.g. `Particulate`).
- OpenCode events exist and show project names.

- [ ] **Step 3: Verify the store file**

Run:

```bash
wc -l ~/.tokenbbq/events.ndjson
head -1 ~/.tokenbbq/events.ndjson
```

Expected: non-zero line count; the first line is valid JSON with `v:1` and `eventHash`.

- [ ] **Step 4: Vendor-data-gone test**

Run:

```bash
mv ~/.gemini ~/.gemini.bak 2>/dev/null || true
curl -s http://localhost:3737/api/data | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log('gemini events:', d.bySource.find(s => s.source==='gemini')?.eventCount ?? 0);"
mv ~/.gemini.bak ~/.gemini 2>/dev/null || true
```

Expected: the Gemini event count is still > 0 (if you had Gemini data to begin with), proving the store survives vendor deletion.

- [ ] **Step 5: Kill the server**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 6: Smoke-run the CLI modes**

```bash
npm run build
./dist/index.js summary
./dist/index.js daily | head -20
./dist/index.js monthly | head -20
```

Expected: each command prints non-empty output with totals consistent with the dashboard.

- [ ] **Step 7: Final commit — mark the plan complete**

```bash
git commit --allow-empty -m "chore: verify project tracking + persistence end-to-end"
```

---

## Post-implementation notes

- The plan leaves `~/.tokenbbq/events.ndjson` on disk between runs. To reset manually: `rm ~/.tokenbbq/events.ndjson`. A `tokenbbq reset` command is explicitly out of scope for v1 (per the persistence spec).
- Amp and Pi-Agent loaders are unchanged. Amp continues to emit events without `project`; those events do not appear in the projects table but do count toward all other totals. Pi-Agent already sets `project` via its folder-name heuristic and benefits from the aggregator changes automatically.
- `sql.js` ships with a WASM binary loaded via `initSqlJs()`. On Node, this resolves from `node_modules/sql.js/dist/sql-wasm.wasm` by default. If bundle-shipping behavior needs tuning (tsdown output), adjust `initSqlJs({ locateFile: ... })` in the OpenCode loader.
