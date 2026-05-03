# TokenBBQ — Konsolidiertes Audit

Stand: 2026-04-30. Branch: `master`. Quelle: 13 paralleler Review-Agents (Static-Analysis) + ein zweiter Reviewer mit Build/Test/Cargo-Verifikation und Crash-Reproduktion. Findings sind dedupliziert und nach Schweregrad sortiert. Jedes Item nennt Datei und Zeile, Symptom, und einen konkreten Fix.

## Reihenfolge zum Abarbeiten

1. CI/Release-Plumbing (sonst arbeiten wir blind).
2. Crash-Pfade und Datenintegrität.
3. Security.
4. Korrektheit (Pricing, Aggregation, Loader).
5. Widget State-Flow.
6. Performance, UX, Cleanup.

---

## CRITICAL

### CI feuert nie

`/.github/workflows/ci.yml:5-6`
Trigger ist `[main]`, Default-Branch ist `master`. Jeder Push und PR seit dem Branch-Rename ist ungeprüft.
Fix: `[main]` → `[master]` an beiden Stellen.

### CI-Matrix nur Linux

`/.github/workflows/ci.yml:11`
`runs-on: ubuntu-latest` für ein Windows-primäres, cross-platform Tool. Path-Separator-Bugs und Plattform-API-Differenzen rutschen durch.
Fix: OS-Achse `[ubuntu-latest, windows-latest, macos-latest]`. Cost-Hedge: nur eine Node-Version auf Non-Linux-Runnern.

### Tests existieren, CI ignoriert sie

`src/aggregator.test.ts`, `src/project.test.ts`, `src/store.test.ts` sind im Repo. CLAUDE.md sagt „no test files exist". `npm test` läuft nirgendwo. `npm test`-Glob expandiert auf Windows nicht.
Fix: `npm test` als CI-Step. Glob durch programmatische Lösung ersetzen oder `tsx --test src/**/*.test.ts`.

### Release publisht npm bevor Widget gebaut/getestet ist

`/.github/workflows/release.yml:39` (npm publish), `:44` (release create), `:52` (widget build via `needs:`).
Wenn der Widget-Build später failt, ist npm bereits draußen und unveränderbar.
Fix: Build und Smoke-Test aller Artefakte zuerst, publish und release zuletzt.

### `toISOString()` crasht bei kaputtem Timestamp

`src/aggregator.ts:32`
Live reproduziert: `RangeError: Invalid time value`. Loader und Store akzeptieren beliebige Timestamp-Strings, der Aggregator setzt valide Daten voraus. Ein einziges malformiertes Event nimmt das ganze Dashboard mit.
Fix: Strikten Timestamp-Normalizer am Ingestion-Punkt (Loader + Store-Load), nicht im Aggregator.

### `new Date()`-Fallback dupliziert Events bei jedem Scan

`src/loaders/amp.ts:78`, `src/loaders/pi.ts:73`
Fehlt der Upstream-Timestamp, wird `new Date()` benutzt. Beim nächsten Scan ändert sich der Timestamp, der Dedupe-Key ändert sich mit, das Event wird erneut angehängt. Wachstum ohne Obergrenze.
Fix: Events ohne validen Timestamp verwerfen oder mit deterministischem Fallback (Datei-mtime als Notnagel).

### `Number(maybeString)` → NaN vergiftet Aggregationen

`src/loaders/claude.ts:40`, `src/loaders/amp.ts:58`, `src/loaders/pi.ts:69` und alle weiteren `Number(usage.x ?? 0)`-Stellen.
`Number("foo") = NaN`, passt durch `=== 0`-Guards und propagiert in alle Sums. JSON serialisiert NaN als `null`.
Fix: Single Helper `ensureNum(v): number` mit `Number.isFinite`-Guard und Non-Negativity-Check. In Store-Load (`src/store.ts:104`) jedes Token-Field validieren statt nur `typeof tokens === "object"`.

### Loader-Default-Pfade nur Linux

`src/loaders/opencode.ts:17`, `src/loaders/amp.ts:16`
Beide hartcodiert auf `~/.local/share/<tool>`. Auf Windows/macOS bekommt der User stillschweigend `[]`.
Fix: Plattform-Kandidaten chainen — Windows `%APPDATA%`, macOS `~/Library/Application Support`, dann XDG. Help-Text in `src/index.ts:46-47` nachziehen.

### OpenCode-Timestamp möglicherweise Sekunden statt Millisekunden

`src/loaders/opencode.ts:113-115`
SQLite-Spalte `time_created` ohne `_ms`-Suffix → typisch Unix-Sekunden. `new Date(seconds)` → Januar 1970, ganze OpenCode-Historie kaputt aggregiert.
Fix: Schema verifizieren. Safe Guard: `if (val < 1e12) val *= 1000`.

### sql.js WASM vermutlich nicht im Sidecar gebündelt

`scripts/build-sidecar.mjs:71`, `widget/src-tauri/tauri.conf.json:41`, `src/loaders/opencode.ts:42`
`initSqlJs()` ohne `locateFile`. Tauri bündelt nur `externalBin`. Im installierten Widget fehlt OpenCode komplett.
Fix: `sql-wasm.wasm` als Asset bündeln, `locateFile` setzen, kompilierten Sidecar gegen eine Test-DB smoketesten.

### Cache-Cost-Fallback rechnet zum Input-Tarif

`src/pricing.ts:84-88`
`pricing.cache_creation_input_token_cost ?? pricing.input_cost_per_token ?? 0`. Modelle ohne explizite Cache-Pricing (viele OpenAI) bekommen Cache-Reads zum Input-Tarif statt 0. Sichtbarer Cost-Inflate bis 10×.
Fix: Bei fehlender Cache-Pricing → 0, nicht `input_cost_per_token`.

### Pricing-Fuzzy-Match ist nicht-deterministisch

`src/pricing.ts:67-71`
Iteration-Order-abhängiger `includes`-Match. `gpt-4` matcht zufällig `gpt-4o` oder `gpt-4-turbo`. Außerdem fehlt der `gemini/`-Prefix in den Lookup-Strategien — alle Gemini-User fallen in den Fuzzy-Match.
Fix: `gemini/` zur Prefix-Liste. Fuzzy-Match entfernen oder mit Mindest-Match-Länge und Segment-Boundary absichern.

### Aggregator UTC-Bucketing für Non-UTC-User

`src/aggregator.ts:33,37,356`
`dateKey`/`monthKey` benutzen `.toISOString().slice(0,10)`. Events nach Mitternacht lokal landen am Vortag, Heatmap und Daily falsch.
Fix: Lokale TZ via `getFullYear`/`getMonth`/`getDate`, oder `Intl.DateTimeFormat` mit fester Server-TZ.

### Aggregator macht 10 Full-Passes mit `new Date()` pro Pass

`src/aggregator.ts:369-390`
Bei 100k Events 10× Full-Loop, jeder mit `new Date(timestamp)` pro Event. Über 700k Date-Allocations.
Fix: Single-Pass-Combinator, Timestamps einmal vor dem Loop parsen (`Date.parse(...)` als Number).

### Widget gibt Session-Key als Klartext an Renderer zurück

`widget/src/main.ts:139-140`, `widget/src-tauri/src/commands.rs:168-173`, `widget/src-tauri/src/api_types.rs:35-40`
`SettingsDisplay.session_key` schickt den Keyring-Wert in die WebView-DOM und in JS-Heap. Hebt den ganzen Sinn der Keyring-Migration auf.
Fix: Feld entfernen. Ersatz: `has_session_key: bool`. Optional separater `reveal_session_key`-Command hinter expliziter User-Aktion.

### Widget bleibt nach transientem API-Fehler auf „err" hängen

`widget/src/main.ts:21,23`
`fetchUsage()` cached `lastUsageJson` vor dem Render. Nach `renderError` returned der nächste identische Erfolg early und re-rendert nicht.
Fix: Cache bei Error invalidieren oder ersten Erfolg nach Error force-rendern.

---

## HIGH

### `/api/data` umgeht Debounce, Polling triggert Full-Scan pro Tab

`src/server.ts:95`, `src/dashboard.ts:1958`
`force=true` skippt den 3s-Debounce. Pro Tab alle 5s ein Full-Filesystem-Scan.
Fix: Normales Polling liefert gecachte Daten. `force=true` nur für Watcher und manuelle Refreshes.

### XSS via Source-Keys in `innerHTML`

`src/dashboard.ts:629/697/1019/1041/1117/1147`
`SOURCE_LABELS[s] || s` direkt in `innerHTML`. Unbekannte Source aus Datei (z. B. neuer Loader oder manipuliertes File) liefert raw HTML.
Fix: `escHtml(SOURCE_LABELS[s] || s)` überall in HTML-Kontext.

### Zwei Escape-Helper mit unterschiedlicher Coverage

`src/dashboard.ts:1059-1061` (`escapeHtml`, escapet `'`), `:1256-1258` (`escHtml`, escapet `'` nicht)
Eine künftige Single-Quote-Attribute mit `escHtml` ist sofort verwundbar.
Fix: Einer Helper, escapet `& < > " '`, ersetze alle Aufrufe.

### Server bindet auf `0.0.0.0`

`src/server.ts:148`
Kein `hostname`-Option, `@hono/node-server` default = all interfaces. `/api/data` ohne Auth, exponiert Project-Namen, Model-IDs, Session-IDs ans LAN.
Fix: `hostname: '127.0.0.1'`.

### `/brand-logo` ohne Sandbox und Size-Limit

`src/server.ts:129-139`, `src/index.ts:55-59`
`TOKENBBQ_LOGO_PATH` wird nur mit `existsSync` geprüft, beliebige Datei readable. `readFile` ohne Size-Cap → OOM-Pfad bei großem File.
Fix: Extension-Whitelist (`.png/.jpg/.webp`), `stat` mit z. B. 10 MB-Cap, optional Pfad in known Directory einschließen.

### Codex `subtractUsage` ohne Tests

`src/loaders/codex.ts:140-142`
Kumulative Subtraktion ist die fragilste Loader-Logik. Off-by-one oder Sign-Error inflatet/zerot still alle OpenAI-Events.
Fix: Test-Fixtures mit Multi-Turn-Cumulative-Total, `Math.max(...,0)`-Guard verifizieren, `freshInput = input - cached` prüfen.

### Amp `toMessageId` Strict-Equality kann immer falsen

`src/loaders/amp.ts:64,67`
`toMessageId: number` vs `m.messageId` (potenziell String). `===` matcht nie → Cache-Tokens immer 0.
Fix: `String(m.messageId) === String(toMessageId)`.

### Gemini Overflow-Fix kippt Cache-Write in Output

`src/loaders/gemini.ts:83-85`
`if (total > known) output += total - known`. Wenn Gemini künftig Cache-Write in `total` packt, landen die als Output-Tokens und werden zum Output-Tarif berechnet.
Fix: Falls cacheCreation immer 0 für Gemini → Kommentar. Sonst Field separat mappen.

### Loader lesen Files seriell

Alle Loader: `for (const file of files) { await readFile(...) }`.
Bei 500 Sessions linear, NVMe wäre 10–25× schneller mit Pool von 32–64 concurrent Reads.
Fix: Concurrency-limited Dispatcher (`p-limit` oder kleiner Semaphor).

### Pricing-Cache speichert Fallback permanent

`src/pricing.ts:43-44`
Bei Network-Failure wird `FALLBACK_PRICES` als Cache gespeichert, kein Retry je Prozesslebenszeit. Long-running Dashboard-Server bleibt nach einem Hiccup bei $0.00.
Fix: Erfolgreichen Cache von Fallback trennen. Fallback ohne Cache zurückgeben, Retry nach Cooldown (z. B. 5 min).

### Pricing fetched JSON mit `as` ohne Runtime-Validation

`src/pricing.ts:41`
`(await res.json()) as Record<string, ModelPricing>`. Format-Change → stille Null-Costs.
Fix: Mindestens `typeof p.input_cost_per_token === 'number'`-Guard in `findModelPricing`.

---

## MEDIUM

### Reasoning-Tokens werden gezählt aber nicht gepreist

`src/types.ts:156` (Total inkl. reasoning), `src/pricing.ts:81` (charge nur input/output/cache)
Live reproduziert: o1/o3/Gemini-Thinking-Sessions zeigen Reasoning-Tokens, kosten aber 0 dafür.
Fix: ModelPricing um `output_cost_per_reasoning_token` ergänzen, im Sum addieren, Fallback auf `output_cost_per_token` bei fehlendem Field.

### Projects mit gleichem Namen mergen

`src/loaders/claude.ts:103` (basename), `src/aggregator.ts:251` (key by display name)
Zwei Repos namens `tokenbbq` an unterschiedlichen Pfaden werden zusammenaggregiert.
Fix: `projectPath` durch UnifiedTokenEvent tragen, Aggregation by Path, Display-Name nur fürs Rendering.

### `aggregateByProject` filtert Unknown raus → byProject summiert nicht zu Total

`src/aggregator.ts:249`
`if (!project || project === 'unknown') continue`. Header-Total und Project-Sum stimmen nicht überein.
Fix: `(no project)`-Bucket statt continue.

### Filtered Dashboard zeigt All-Time `byProject`

`src/dashboard.ts:1073`
Datums-Filter wirkt nicht auf den Projekt-View.
Fix: byProject auf das Filter-Range einschränken.

### Dedupe-Keys zu schwach

`src/loaders/claude.ts:108` (Fallback-Key ohne Session/File), `src/loaders/pi.ts:74` (`pi:${ts}:${input+output}`)
Pi-Key lässt zwei Calls in derselben Sekunde mit gleicher Token-Summe kollidieren.
Fix: `${source}:${sessionId}:${file}:${model}:${ts}:${input}:${output}` (jeweils relevante Subset).

### Loader sortieren intern obwohl `loadAll` global sortiert

`src/loaders/claude.ts:121`, `gemini.ts:121`, `opencode.ts:139`, `amp.ts:93`, `pi.ts:99`
Vertrag in CLAUDE.md ist explizit. 5 redundante Sorts pro Refresh, alle 3s in Server-Mode.
Fix: Per-Loader-Sort entfernen.

### Loader-`LoaderOptions`-Param wird ignoriert

`src/loaders/claude.ts:64`
Signatur akzeptiert keine Options. Strukturelle Typing lässt es durch, aber `quiet` wird nicht honored.
Fix: `_opts?: LoaderOptions` mindestens als Stub.

### `enrichCosts` ist O(n × P)

`src/pricing.ts:97`
Pro Event Full-Lookup mit Fuzzy-Pass über ~2000 LiteLLM-Keys.
Fix: Per-Distinct-Model-Cache (`Map<modelName, pricing>`), Events nach Modell gruppieren.

### Keine gzip-Compression

`src/server.ts`
JSON-Payload bei großem Datensatz mehrere hundert KB, alle 5s an jeden Client.
Fix: `app.use(compress())` von `hono/compress`.

### Widget Drag-Persistenz schreibt synchron pro Mouse-Move

`widget/src-tauri/src/lib.rs:83-87`
`WindowEvent::Moved` feuert pro Pixel. Synchroner `WriteFile` pro Event auf der Tauri-Event-Thread.
Fix: Debounce (z. B. 500 ms) oder auf `DragEnd`/`CloseRequested` schieben.

### Widget Position-Validation prüft nur Punkt-auf-Monitor

`widget/src-tauri/src/lib.rs:26-29`
Anchor kann auf Monitor sein, der Rest des Widgets off-screen. Mixed-DPI-Multi-Monitor zusätzlich problematisch (`win.outer_size()` gegen falschen DPI).
Fix: Bounds-Clamp auf Work-Area des Ziel-Monitors. `monitor.scale_factor()` benutzen, um logische Größe in physische Pixel des Ziels zu konvertieren.

### Widget Reset-Labels einfrieren bei unverändertem JSON

`widget/src/main.ts:23`
Early-Return verhindert UI-Update auch bei Reset-Operationen, die kein neues JSON liefern.
Fix: Cache-Vergleich nicht für Reset-Pfad anwenden, oder Reset triggert force-render.

### Widget Local-Expanded-Totals stale nach Sidecar-Failure

`widget/src/main.ts:49`
Lokal akkumulierte Anzeige bleibt auch wenn der Sidecar Fehler liefert.
Fix: Bei Sidecar-Error die expanded Totals invalidieren.

### Widget `saved_at` refresht bei unrelated Saves

`widget/src/main.ts:139`
Session-Key-Prefill triggert Update auch wenn der Key unverändert ist.
Fix: Nur bei tatsächlichem Field-Change `saved_at` setzen.

### UTF-8 BOM nicht gestrippt

Alle JSONL-Loader und `src/store.ts:77`.
Erste Zeile mit BOM crasht `JSON.parse`, wird stillschweigend gedroppt.
Fix: `content = content.replace(/^﻿/, '')` einmal vor dem Split.

### Codex sessionId mit `\\` → `/` Replace bricht UNC-Pfade

`src/loaders/codex.ts:84`
`replace(/\\/g, '/')` kollabiert führendes `\\` von UNC-Shares.
Fix: `path.relative(...).split(path.sep).join('/')`.

### Open-Browser-Failure ist still

`src/server.ts:157`
`.catch(() => {})` schluckt jeden Error. User merkt nicht, warum kein Tab aufgeht.
Fix: Catch-Branch loggt eine Hinweis-Zeile auf die URL.

### `tsconfig.json` ohne `noUncheckedIndexedAccess` und `exactOptionalPropertyTypes`

Wichtigste Compile-Time-Guards für genau diesen Code-Stil (Records, Optional Project-Field, JSON-Indexing).
Fix: Beide aktivieren, anfallende ~15–20 Sites mit `?? fallback` oder begründetem `!` versehen.

### CLI ohne `--days`/`--since`

`src/index.ts:125-135`
Daily/Monthly/Summary dumpen die ganze Historie.
Fix: `--days=<n>` (Default 90) und Slicing in den Render-Funktionen.

### CLI ohne `--version`

`src/index.ts` `parseArgs`
`tokenbbq --version` öffnet einen Browser-Tab.
Fix: `--version`/`-V` parsen, Version aus `package.json` (build-time inject via tsdown define).

### Empty-Store exit code 0

`src/index.ts:94-105`
CI/Wrapper sieht Misconfig nicht.
Fix: Non-Zero Exit für interaktive Pfade. `scan`/`--json` weiter 0.

### Port-Collision-Log auf stdout

`src/server.ts:143-153`
`console.log` korrumpiert eventuelle JSON-Pipes.
Fix: `log`-Callback durchreichen, Default unverändert.

### `fmtUSD` immer 2 Decimals

`src/dashboard.ts:401`
Sub-Cent-Tagesummen erscheinen als `$0.00`.
Fix: Adaptive Precision (4 unter $0.01, 3 unter $1, sonst 2).

### Hardcoded Dark-Mode

`src/dashboard.ts:9`, `:752-773`
`class="dark"` hartcodiert, `prefers-color-scheme` ignoriert, kein Persist.
Fix: Inline-Pre-Hydration-Script liest `localStorage.theme` || `matchMedia('(prefers-color-scheme: dark)')`. Toggle persistiert in localStorage.

### Help-Text dokumentiert keine Env-Vars

`src/index.ts:24-50`
`TOKENBBQ_LOGO_PATH` und die sechs Tool-Dir-Overrides sind aus `--help` nicht ersichtlich.
Fix: `Environment:`-Section in `printHelp`.

### `tsdown` `.mjs` → `.js` Rename

`package.json:45`, `tsdown.config.ts`
Manuelle Rename via `node -e require('fs').renameSync` in einem `"type":"module"`-Paket.
Fix: `outExtension: () => ({ js: '.js' })` in tsdown.config, Build-Script auf `tsdown` reduzieren.

### `@types/node` auf `^22` bei `engines.node: ">=20"`

`package.json:66`
Node-22-only-API würde am 20er-Runtime crashen, type-check täuscht.
Fix: `^20.0.0`.

### Live-Refresh ohne visuelles Feedback

`src/dashboard.ts:1225,1969`
Daten ändern sich, UI swapt still.
Fix: Kurzes Flash auf "Generated"-Element bei Datenänderung.

### Heatmap Color-Scheme nicht color-blind safe

`src/dashboard.ts`
GitHub-Greens unsichtbar bei Deuteranopia.
Fix: Tooltip-Wert reicht als Kompromiss; alternativ Viridis-Skala.

---

## LOW / Cleanup

- `src/pricing.ts:76` `calculateCost` exportiert, nirgends extern importiert. → Export entfernen.
- `src/loaders/codex.ts:32,43,52` `RawUsage.total` geschrieben, nie gelesen. → Field entfernen.
- `src/loaders/codex.ts:140-142` Zwei überlappende Zero-Token-Guards, einer subsumed. → Zeile 140 löschen.
- `src/dashboard.ts:5` `options?: any` mit einer einzigen Property. → Inlinen, `any` entfernen.
- `src/server.ts:43,57` `getData?:` optional, immer gesetzt. → Required machen, Guard entfernen.
- `src/store.ts:161-164` `readdirSync`-Catch nach vorgehendem `mkdirSync({recursive:true})` unreachable. → Catch entfernen.
- `src/dashboard.ts:1120,1123` `p.projectPath || p.project` wo `projectPath` immer gleich `project`. → Fallback entfernen.
- `src/loaders/index.ts:72` `LOADERS[results.indexOf(result)]!.source` mit Non-Null-Assertion. → `find`-by-Index oder Zip.
- `src/aggregator.ts:80,139,204,285,318` `unique(agg.sources) as Source[]`-Casts. → Cast entfernen, Type propagiert.
- CLAUDE.md "no test files currently exist" stale. → Eine Zeile updaten.
- Widget `skipTaskbar: false` für Always-on-Top Pill. → `true` für UX-Konsistenz mit Tray.
- Widget `open_full_dashboard` ersetzt args by string equality. → Subcommand explizit übergeben.

---

## Test-Strategie

`node --test --import tsx` ist der richtige Runner für dieses Projekt — ESM-strict, kein zusätzliches Setup, läuft auf der Node-20/22/24-Matrix.

Top-Tests nach ROI:

1. `pricing.test.ts` — `findModelPricing` Lookup-Chain. Exact, prefix, `[pi]`-Strip, Date-Strip, Fuzzy, Miss. Dazu `calculateCost`-Arithmetik mit/ohne Cache-Pricing.
2. `loaders/claude.test.ts` — `parseLine` Happy-Path, Missing usage, Zero-Tokens, CRLF, Dedupe-Pair, Cache-Field-Mapping.
3. `loaders/codex.test.ts` — Cumulative-Subtract über Multi-Turn, `freshInput`, `Math.max(...,0)`-Guard, `turn_context`/`session_meta`-Updates.
4. `loaders/gemini.test.ts` — `total > known`-Reconciliation, `looksLikeProjectHash`-Filter, ID-vs-Timestamp-Dedupe.
5. `loaders/pi.test.ts` — `[pi] `-Prefix, `cost.total`-Passthrough, Type/Role-Filter.
6. `aggregator.test.ts` — extend: empty input, `aggregateDaily` mit Same-Day Events, `bySource`-Tiebreaker, UTC-vs-local Bucketing-Test.
7. `store.test.ts` — extend: BOM-Line, `v: "1"`-String, `tokens: null`.
8. `pricing.test.ts` — Cache-Fallback-Pfad spezifisch (rührt Critical „Cache zum Input-Tarif" an).
9. `loaders/amp.test.ts` — `toMessageId`-Lookup mit String-vs-Number-Mismatch.
10. `parseArgs` — `scan` impliziert `--json`, `--port=`, default-command.

Layout: Sibling `.test.ts` (matched existierenden Stil), Fixtures in `src/loaders/__fixtures__/`.

---

## Verifikations-Punkt

Der zweite Reviewer hat lokal `npm run lint`, `npm run test`, `npm run build`, Widget `npm run lint`/`build` und `cargo check` grün durchlaufen lassen, dazu den Invalid-Timestamp-Crash und Reasoning-Token-Pricing-$0 reproduziert. Das ist der State, gegen den die Crash-Items hier gemessen wurden.
