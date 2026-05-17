# 🔥 Code-Review: Token-Berechnung TokenBBQ vs. ccusage

> **Datum:** 2026-05-17
> **Scope:** Token- & Kosten-Berechnung im Dashboard (`src/loaders/`, `src/aggregator.ts`, `src/pricing.ts`, `src/store.ts`)
> **Referenz:** ccusage v18.0.8 (vendored unter `ccusage/`)
> **Methode:** Unabhängige Code-Analyse + Cross-Check via Codex; alle Codex-Behauptungen am Code gegengeprüft.
> **Ziel:** Unsere Zahlen sollen mit ccusage übereinstimmen.

## TL;DR — Stimmen unsere Zahlen mit ccusage überein?

**Claude Code (ccusage-Kerndomäne):** Token-Summen stimmen *fast* — Formel, Dedup und Datums-Bucketing sind identisch. Aber die **Kosten** weichen systematisch nach unten ab (fehlende >200k-Staffelpreise). **Codex:** Die Dashboard-Token sind **systematisch zu hoch** (Reasoning-Doppelzählung) — das ist die sichtbarste Abweichung beim Vergleich pro Tool.

| # | Schwere | Bereich | Effekt |
|---|---------|---------|--------|
| 1 | 🔴 Kritisch | Codex-Tokens | Total systematisch **zu hoch** |
| 2 | 🔴 Kritisch | Claude-Kosten | Kosten **zu niedrig** bei großen Kontexten |
| 3 | 🟠 Wichtig | Robustheit | Ein kaputtes Feld kann Total auf `NaN` ziehen |
| 4 | 🟡 Mittel | Claude-Tokens | Cache-only-Events fallen raus (Unterzählung) |
| 5 | 🟡 Mittel | Claude-Tokens | Synthetischer Dedup-Key kollabiert echte Events |
| 6 | 🟢 Architektur | Alle | Persistenter Store driftet vs. stateless ccusage |

---

## 🔴 1. Codex: Reasoning-Tokens werden doppelt gezählt

**Ort:** `src/loaders/codex.ts:166` (`reasoning: raw.reasoning`) + `src/types.ts:165` (`totalTokenCount`) + `src/dashboard.ts:413`

**Divergenz:** OpenAI/Codex liefert `output_tokens` **inklusive** der Reasoning-Tokens; `reasoning_output_tokens` ist nur eine informative Teilmenge. ccusage implementiert das explizit:

- `ccusage/apps/codex/src/data-loader.ts:60-62`: *„includes them as a separate field but does not add them to total_tokens"* → `total = input + output`
- `ccusage/apps/codex/src/token-utils.ts:39`: *„Reasoning tokens are already included in output_tokens, so they are not added separately to avoid double-counting"* — die Kostenformel hat **keinen** Reasoning-Term.

TokenBBQ speichert `reasoning` separat **und** `totalTokenCount` summiert `input+output+cacheCreation+cacheRead+reasoning`. Da `output` die Reasoning-Tokens bereits enthält, zählt jedes Codex-Event seine Reasoning-Tokens **zweimal**. Bei gpt-5/o-Modellen (Codex' Standard) oft 50–90 % der Output-Tokens → massive Überzählung in Dashboard-Total, Heatmap, `topModel` und jeder Tokens-Chart.

**Fix:** Für Codex `output` als Brutto behalten und `reasoning` nur als Anzeige-Metainfo führen (nicht im Total). ccusage' Weg: Codex' eigenes `total_tokens` (in `normalizeUsage` bereits berechnet, aber nie verwendet) als Wahrheit nehmen statt selbst zu rekonstruieren.

---

## 🔴 2. Claude: Fehlende Staffelpreise >200k Tokens

**Ort:** `src/pricing.ts:109-127` (`calculateCost`)

**Divergenz:** ccusage rechnet Claude/Anthropic-Modelle mit **Tiered Pricing** ab — Tokens über 200k pro Token-Typ pro Event zur höheren Rate (`ccusage/packages/internal/src/pricing.ts:284-336`, `calculateTieredCost`). Für Sonnet 4: cache_read 200k+ zu $0,60/M statt $0,30/M (2×), Input 2×, Output 1,5×.

`pricing.ts` nutzt ausschließlich Flat-Raten. In Claude-Code-Sessions ist `cache_read` pro Turn praktisch der gesamte bisherige Kontext — regelmäßig **>200k**. Ergebnis: TokenBBQ **unterberechnet** Kosten heavy-user-Sessions deutlich. Wahrscheinlich der größte moderne Kosten-Mismatch.

**Fix:** `ModelPricing`-Typ um `*_above_200k_tokens`-Felder erweitern und `calculateTieredCost`-Logik (200k-Schwelle, pro Token-Typ) nachbauen. Schwelle nur für Claude/Anthropic (GPT = flat, Gemini = 128k — Letzteres setzt auch ccusage nicht um).

**Nebenpunkt:** Bei `auto` nutzt ccusage `data.costUSD`, sobald `!= null`. TokenBBQ rechnet neu, sobald `costUSD <= 0`. Bei modernen Logs ohne `costUSD` rechnen beide → Punkt 2 dominiert. Bei Logs *mit* `costUSD: 0` weicht ihr ab (ihr rechnet, ccusage nimmt 0). Selten.

---

## 🟠 3. Robustheit: Nicht-numerische Token-Felder vergiften das Total mit `NaN`

**Ort:** `src/loaders/claude.ts:42-44`

```ts
const input = Number(usage.input_tokens ?? 0);
const output = Number(usage.output_tokens ?? 0);
if (input === 0 && output === 0) return null;
```

**Divergenz:** `?? 0` fängt nur `null`/`undefined`. Ist `usage.input_tokens` ein String/Objekt, wird `Number(...)` → `NaN`. Der Guard `input === 0 && output === 0` ist bei `NaN` `false` → das Event passiert mit `tokens.input = NaN`. `addTokens` propagiert das → **das gesamte Dashboard-Total wird `NaN`**. ccusage' valibot-`v.number()` lehnt solche Einträge hart ab.

Verschärfend: `store.ts:isTokenCounts` prüft `typeof t.input === 'number'` — `NaN` ist `typeof 'number'`, läuft also durch und wird **dauerhaft persistiert** (Store-Cache vergiftet bis manueller Eingriff).

**Fix:** Nach Konvertierung `Number.isFinite()` erzwingen für alle 4 Token-Felder (`const input = Number(usage.input_tokens); if (!Number.isFinite(input)) return null;`), zusätzlich in `store.ts:isTokenCounts` `Number.isFinite` statt nur `typeof === 'number'`.

---

## 🟡 4. Claude: Cache-only-Events werden verworfen

**Ort:** `src/loaders/claude.ts:44` — `if (input === 0 && output === 0) return null;`

**Divergenz:** ccusage' `usageDataSchema` verlangt nur, dass `input_tokens`/`output_tokens` Zahlen sind (0 erlaubt) und summiert `cache_creation`/`cache_read` trotzdem (`ccusage/apps/ccusage/src/data-loader.ts:441`). TokenBBQ wirft das ganze Event weg, *bevor* die Cache-Felder gelesen werden — Events mit `input=0, output=0, cacheRead>0` gehen verloren → Unterzählung von Tokens **und** Kosten. Selten, aber real.

**Fix:** Guard erst nach Berechnung aller fünf Felder anwenden und nur verwerfen, wenn die Gesamtsumme 0 ist (oder ganz weglassen — ccusage filtert hier nicht).

---

## 🟡 5. Claude: Synthetischer Dedup-Fallback kollabiert echte Events

**Ort:** `src/loaders/claude.ts:135-137`

```ts
const dedupeKey = requestId && messageId
  ? `${messageId}:${requestId}`
  : `${event.timestamp}:${event.model}:${event.tokens.input}:${event.tokens.output}`;
```

**Divergenz:** ccusage' `createUniqueHash` gibt `null` zurück, wenn messageId **oder** requestId fehlt — `isDuplicateEntry(null)` ist immer `false`, ID-lose Events werden **nie** dedupliziert (alle gezählt). TokenBBQ baut einen synthetischen Key und dedupliziert sie doch → potenzielle Unterzählung.

**Zusatz:** Der Fallback-Key enthält **nur** `timestamp:model:input:output` — *nicht* `cacheCreation`, `cacheRead`, `costUSD` oder Session/Datei. Zwei ID-lose Events mit gleichem input/output aber unterschiedlichen Cache-Tokens kollidieren und eines wird fälschlich verworfen. Moderne Logs haben immer beide IDs (geringe Praxisrelevanz), aber für exakte ccusage-Parität: Fallback streichen und ID-lose Events wie ccusage immer durchzählen.

---

## 🟢 6. Architektur: Persistenter Store driftet vs. stateless ccusage

**Ort:** `src/store.ts` (`hashEvent`, `appendEvents`) + `src/index.ts:117`

**Divergenz:** ccusage ist **stateless** — liest bei jedem Lauf die JSONL-Dateien neu. TokenBBQ persistiert append-only und dedupliziert per **Content-Hash** (`source|sessionId|timestamp|model|input|output|cacheRead|cacheCreation|reasoning`) — ein *anderer* Schlüssel als ccusage' `messageId:requestId` (inkl. timestamp, ohne requestId). Folgen:

1. **Drift nach Log-Rotation:** Löscht/rotiert der User alte Claude-JSONLs, zeigt ccusage weniger, TokenBBQ behält die Historie → TokenBBQ > ccusage. Bewusst so designt, bricht aber exakte Parität.
2. Claude kommt im Dashboard aus `store.events` (nicht aus dem Frisch-Scan), der Store-Hash gewinnt. Kollidieren zwei legitim verschiedene Events im Content-Hash, ist eines **dauerhaft** weg (Hash bleibt in `state.hashes`, Re-Scan heilt nicht).

**Empfehlung:** Design-Entscheidung dokumentieren („TokenBBQ ≥ ccusage nach Log-Pruning" = erwartet). Falls Bit-Parität gewünscht: optionaler „stateless/ccusage-compat"-Modus, der nur den Frisch-Scan ohne Store rendert.

---

## ✅ Was bereits korrekt mit ccusage übereinstimmt

- **Claude-Total-Formel** `input+output+cacheCreation+cacheRead` = ccusage `getTotalTokens` (Reasoning bei Claude immer 0) — exakt gleich.
- **Datums-Bucketing:** Beide lokale Zeitzone, `YYYY-MM-DD`. Identisch, solange ccusage ohne explizites `--timezone` läuft.
- **Dedup bei vorhandenen IDs:** `messageId:requestId` — identisch zu ccusage.
- **`isApiErrorMessage`:** ccusage filtert das **nicht** aus den Totals (nur für Reset-Time-Extraktion) — TokenBBQ ebenso. Kein Handlungsbedarf.
- **`<synthetic>`-Modell:** Nur Anzeige-Divergenz (ccusage versteckt die Modellzeile, zählt Tokens mit). Totals unberührt — TokenBBQ zeigt zusätzlich eine `<synthetic>`-Zeile, kann `topModel` beeinflussen. Kosmetisch.
- **Fehlendes `message.usage`:** Beide überspringen. Konsistent.

---

## Empfohlene Fix-Reihenfolge (Aufwand vs. Wirkung)

1. **#1 Codex-Reasoning** — größte sichtbare Token-Abweichung, kleiner gezielter Fix.
2. **#3 NaN-Guard** — echter Bug, billig, schützt zusätzlich den Store.
3. **#2 Tiered Pricing** — größte Kosten-Abweichung, mittlerer Aufwand (`calculateTieredCost` portieren).
4. **#4 + #5 Claude-Loader** — zusammen in `claude.ts` erledigbar (Guard nach hinten, Fallback-Key streichen).
5. **#6** — Doku / optionaler Compat-Modus, kein dringender Code-Fix.

---

## Resolution (umgesetzt 2026-05-17, Branch `fix/ccusage-parity`, Codex-abgenommen)

Alle 6 Findings behoben, je ein Commit, Design von Codex mit **PASS** abgenommen.

| # | Umsetzung | Tests |
|---|-----------|-------|
| 1 | `totalTokenCount` ohne `reasoning` (types.ts); alle Client-Summen in dashboard.ts; Reasoning als nicht-additiver Info-Wert | `types.test.ts`, Codex-Paritäts-Invariante in `codex.test.ts` |
| 2 | `calculateTieredCost` (faithful port, 200k, pro Token-Typ, pro Event) in `pricing.ts`; `ModelPricing` + FALLBACK erweitert | `pricing.test.ts` (Boundary + flat-fallback) |
| 3 | `parseLine` verlangt finite `v.number()`-Parität; `store.ts` `isTokenCounts`/`loadFile` finite-gehärtet | `claude.test.ts`, `store.test.ts` |
| 4 | Zero-Token-Drop entfernt (Cache-only & 0/0 bleiben wie bei ccusage) | `claude.test.ts` |
| 5 | `dedupeKey=null` bei fehlender msgId/reqId, nie dedupliziert; Fallback entfernt; Loader-`CACHE_VERSION` 1→2 | `claude.test.ts` |
| 6 | Store-Härtungs-Regressionstest + dokumentierte Invariante (kein Hash-Migration, keine neue Betriebsart — Userentscheidung) | `store.test.ts` |

### Bewusst akzeptierte Rest-Divergenzen (von Codex bestätigt, vom User so entschieden)

- **#1 Codex-Total-Quelle:** ccusage nutzt die gemeldete `total_tokens`; wir rekonstruieren `freshInput+cacheRead+output`. Da OpenAI `total_tokens ≡ input+output` definiert, sind sie für wohlgeformte Logs **gleich** (Regressionstest sichert das ab). Eine separate „reported total" durch das vereinheitlichte 5-Feld-Modell zu schleifen wäre invasiv — bewusst nicht umgesetzt.
- **#6 Store vs. stateless:** Nach **manuellem** Log-Pruning behält TokenBBQ Historie (TokenBBQ ≥ ccusage) — gewollt. Keine kryptografische Kollisionsgarantie ohne Store-Hash-Migration — bewusst außerhalb des Scopes.
