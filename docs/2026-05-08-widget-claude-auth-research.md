# Widget Claude-Auth Research

**Date:** 2026-05-08
**Scope:** Investigate alternatives to the manual `sessionKey` paste in the TokenBBQ widget for fetching Claude Code Pro/Max 5h/7d rate-limit data.
**Status:** Research only — no code changes proposed.

## Problem statement

The TokenBBQ widget today fetches Claude Code rate-limit data via:

- `Cookie: sessionKey=<key>` against `https://claude.ai/api/organizations/{org_id}/usage`
- `sessionKey` and `org_id` are entered manually by the user (paste from browser devtools), persisted in OS keyring (`commands.rs:35-66`).

The Codex side (`src/loaders/codex.ts:208-263`) has no equivalent friction — it reads `~/.codex/sessions/**/*.jsonl` passively. Codex itself writes rate-limit snapshots into its session log (`event_msg.payload.token_count.rate_limits`).

Goal of this investigation: determine whether a similarly clean, paste-free path exists for Claude Code, and document what's tried/ruled out.

## What was already in the note

`Local Auth Discovery Notes` (in-flight planning note) proposed:

1. Detect Claude Code via `claude auth status`.
2. Offer a "Connect Claude Code" button that runs `claude auth login` if needed.
3. Install or chain a small statusline bridge that writes the statusline `rate_limits` payload to a TokenBBQ-owned file.
4. Read 5h/7d limits from that bridge file, drop `extra_usage` (not in statusline payload).

The note correctly identified that `rate_limits` is exposed via the Claude Code statusline JSON, and that `extra_usage` is not.

## What was verified

### Confirmed against official documentation

- **`rate_limits` in statusline JSON**: documented at `code.claude.com/docs/en/statusline`. Fields: `rate_limits.five_hour.{used_percentage, resets_at}` and `rate_limits.seven_day.{used_percentage, resets_at}`. The note's mapping is correct.
- **`extra_usage` not in statusline**: confirmed.
- **`claude auth status`** exists, returns JSON, exits 0/1 — usable for programmatic detection.
- **`claude auth login` / `logout`** exist as documented subcommands.

### New constraints not in the note

- `rate_limits` only appears for Claude.ai subscribers (Pro/Max), and only **after the first API response in a session**. API-key users get nothing.
- `five_hour` and `seven_day` can be independently absent.
- Statusline runs after assistant messages, `/compact`, permission-mode changes, vim-mode toggles. Debounced 300ms. Optional `refreshInterval` for time-based refresh, but only while a session is open.
- Workspace-trust gate per directory.
- Only one `statusLine` slot per settings scope.

## Local data sources investigated and ruled out

| Source | Has rate_limits? | Notes |
|---|---|---|
| `~/.claude/projects/**/*.jsonl` | **No** | Per-message `usage` (token counts) only. Verified via type scan: `assistant`, `system`, `user`, `attachment`, `file-history-snapshot`, `last-prompt`, `permission-mode`, `pr-link`, `queue-operation`, `ai-title` — none carry rate-limit metadata. |
| `~/.claude/usage-data/session-meta/*.json` | No | Session statistics (counts, durations, languages). |
| `~/.claude/usage-data/facets/*.json` | No | IDE statistics. |
| `~/.claude/sessions/<pid>.json` | No | PID → session-id mapping for running CC instances. |
| `~/.claude/stats-cache.json` | No | IDE stats cache. |
| `~/.claude/.credentials.json` | Token only | Plaintext OAuth: `accessToken`, `refreshToken`, `expiresAt`, `scopes`, `subscriptionType`, `rateLimitTier`. See OAuth section below. |
| `~/.config/claude-code/auth.json` | N/A | Does not exist on Windows; XDG-style Linux path. |
| Local IPC ports/named pipes of running `claude.exe` | No | `netstat` shows no obvious local listening port for the process. |
| `claude -p --output-format json` envelope | Indirectly | See stream-json finding below. |
| `claude /usage` slash command | Interactive only | Slash commands don't reliably fire under `-p`. |
| Hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) | No | Empirically verified — see "Hook-bridge feasibility" below. |
| MCP / `claude mcp serve` | No | No documented Anthropic plan/quota MCP server. |
| Anthropic Admin / Usage & Cost API | No | Not for individual claude.ai subscribers — Enterprise / API-org only. |

## OAuth token — partial reuse (claude.ai blocked, api.anthropic.com works)

`~/.claude/.credentials.json` contains a plaintext OAuth `accessToken` (format `sk-ant-oat01-...`).

| Test | Endpoint | Auth | Result |
|---|---|---|---|
| 1 | `https://claude.ai/api/organizations` | `Authorization: Bearer <token>` | **403** `account_session_invalid` |
| 2 | `https://claude.ai/api/organizations` | `Cookie: sessionKey=<token>` | **403** `account_session_invalid` |
| 3 | `https://api.anthropic.com/v1/messages` | `Authorization: Bearer <token>` | **200** real response |

The OAuth token is rejected by the claude.ai web frontend (different auth surface) but accepted by the public Anthropic API. The web-frontend `/api/organizations/{org_id}/usage` endpoint that the widget calls today is therefore not reachable with this token.

**However**, the public API exposes equivalent rate-limit data via *response headers* on every successful `/v1/messages` call. This is the path documented in the next section.

## Option G — `anthropic-ratelimit-unified-*` headers via OAuth (viable, undocumented)

A successful POST to `https://api.anthropic.com/v1/messages` with the OAuth Bearer token returns a set of undocumented response headers:

```
anthropic-ratelimit-unified-status: allowed
anthropic-ratelimit-unified-5h-status: allowed
anthropic-ratelimit-unified-5h-reset: 1778244600
anthropic-ratelimit-unified-5h-utilization: 0.66
anthropic-ratelimit-unified-7d-status: allowed
anthropic-ratelimit-unified-7d-reset: 1778400000
anthropic-ratelimit-unified-7d-utilization: 0.28
anthropic-ratelimit-unified-overage-status: allowed
anthropic-ratelimit-unified-overage-reset: 1780272000
anthropic-ratelimit-unified-overage-utilization: 0.0
anthropic-ratelimit-unified-representative-claim: five_hour
anthropic-ratelimit-unified-fallback-percentage: 0.5
anthropic-ratelimit-unified-fallback: available
anthropic-ratelimit-unified-reset: 1778244600
anthropic-organization-id: 5f43ca54-...
```

This covers everything the widget displays today: 5h utilization, 7d utilization, both reset timestamps, and overage (the equivalent of the existing `extra_usage`). Plus `anthropic-organization-id` removes the need for the existing `auto_detect_org` flow.

### Where the headers do and don't appear

Empirical probe results:

| Test | Endpoint | Status | Headers? |
|---|---|---|---|
| C | POST empty body `{}` | 400 (validation) | **No** — only `anthropic-organization-id` |
| D | POST invalid model name | 404 | **No** — only `anthropic-organization-id` |
| E | **POST `max_tokens=0`** | **200** | **Yes — full unified-* set** |
| F | `/v1/messages/count_tokens` | 200 | **No** — only `anthropic-organization-id` |

The headers are emitted only on successful `/v1/messages` calls. Validation errors (400/404) and the free `count_tokens` endpoint do not include them.

### Cost per refresh

`max_tokens=0` is the cheapest legal call:

- Body returns `usage: {input_tokens: 8, output_tokens: 0}`
- API rates (Haiku 4.5): ~$0.0000064 per call
- Pro/Max users: 8 input tokens against the 5h quota
- With 60s throttling: ~480 tokens/hour — well under 1‰ of typical 5h limits
- API-key users: ~$0.01/day at continuous polling

For the widget's UX the impact on its own displayed numbers is negligible.

### Caveats

1. **Headers are undocumented.** Anthropic's public API docs describe the older `anthropic-ratelimit-requests-limit/remaining/reset` and `anthropic-ratelimit-tokens-*` headers. The `anthropic-ratelimit-unified-*` set is not in the public spec. Anthropic could rename or remove it without notice.
2. **`.credentials.json` is also undocumented.** Anthropic could move the token to OS keystore or encrypt it; both would break our reader.
3. **Token expiration.** If the user hasn't run `claude auth login` recently, the token may be expired — call returns 401, we fall back to the existing sessionKey path (or prompt re-login).
4. **Layering violation.** TokenBBQ would be reading another tool's auth state. Anthropic chose to put it on disk in plaintext, so we don't worsen the security surface, but we couple ourselves to their internal storage choices.
5. **Tiny but non-zero quota consumption.** Pro/Max users see refresh calls counted against their 5h window. Throttle to 60s+ to keep drift trivial.

### Mitigation strategy

Wrap Option G as a primary path with the existing sessionKey path as fallback:

- Read `~/.claude/.credentials.json`. On schema drift / missing fields → fall back.
- Call `/v1/messages` with `max_tokens=0` and the OAuth Bearer. On 401 / 403 / network error → fall back.
- Parse `anthropic-ratelimit-unified-*` headers. On missing headers → fall back.
- Fallback = today's keyring-based sessionKey + claude.ai/api path. No regression for existing users.

## Browser cookie import — evaluated and rejected

The most direct paste-removal path that preserves the existing `claude.ai/api/.../usage` HTTP call (and therefore `extra_usage`): read the user's `sessionKey` cookie directly from the installed browser's profile.

Rejected for these reasons:

1. **Modern Chrome cookies are encrypted with App-Bound Encryption on Windows** (and DPAPI before that). Decryption requires either DPAPI bypass via the user's Windows credentials (legitimate but invasive — TokenBBQ becomes a credential-handling surface) or App-Bound Encryption bypass (treated as theft by Chrome's threat model; flagged by malware scanners; breaks on every Chrome update).
2. **Same fragility as the current sessionKey path, plus more attack surface.** When the cookie expires we'd silently 401 just like today; the user has to re-login to claude.ai. We've eliminated the paste but not the underlying brittleness.
3. **Browser-specific.** Chrome, Edge, Brave each have separate profile paths and cookie stores. Firefox uses a different format. Safari is sandboxed entirely on macOS. Maintaining N browser readers for a feature whose proper solution lives in Anthropic's hands is wrong shape.
4. **Indistinguishable from credential theft.** Antivirus heuristics flag any process that reads cookies from another browser's profile. Even if the user knows we're doing it, EDR tools and Defender don't.

The current paste flow keeps the cookie-handling surface minimal: user pastes once, we store in OS keyring, we send it as one HTTP header. Replacing the paste with cookie-store-read trades a one-time UX wart for a permanent security and maintenance liability.

Sources: Chrome Security FAQ on encrypted credential storage; Google Security Blog on App-Bound Encryption.

## Stream-json finding (new)

Running `claude -p --verbose --output-format stream-json "say hi"` emits an undocumented event in the stream:

```json
{
  "type": "rate_limit_event",
  "rate_limit_info": {
    "status": "allowed",
    "resetsAt": 1778244600,
    "rateLimitType": "five_hour",
    "overageStatus": "allowed",
    "overageResetsAt": 1780272000,
    "isUsingOverage": false
  }
}
```

This is genuinely a fresh local source, but weaker than the existing paths:

1. **No `used_percentage`.** Only binary `status: allowed/throttled`. The widget today shows percentage values; they would be lost.
2. **Not persisted to disk.** Verified: zero `rate_limit_event` entries across all `~/.claude/projects/**/*.jsonl`. The Codex pattern (passive read of past events) is not possible.
3. **Active call consumes the user's own quota.** A single `claude -p "say hi"` invocation reported `total_cost_usd: 0.23` (37k cache-creation tokens at API rates). For Pro/Max subscribers there's no direct dollar charge — the subscription covers it — but the call counts against the very 5h/7d quota the widget is trying to display. The path is recursive: spend quota to learn how much quota remains. For API-key users this would be a real per-refresh dollar charge.

`--bare` mode skips auto-discovery of hooks, skills, plugins, MCP servers, auto-memory, and `CLAUDE.md` per the CLI docs. Whether statusline is also skipped is **unverified** — the docs don't list it among the auto-discovery set.

## Statusline-bridge feasibility

The statusline-bridge approach (the note's proposal) is the only path that uses a documented Anthropic surface to get `used_percentage`. Real blockers:

1. **Existing user statusLine config conflict.** Only one `statusLine` per settings scope. Power users — who are most likely to want this widget — already have `ccstatusline`, `starship-claude`, or custom scripts. Overwriting is wrong; chaining (wrapping their command) is brittle.
2. **Project settings override user settings.** If the user has a project-level statusLine, our user-level bridge sees nothing in that directory.
3. **Workspace trust gate.** Statusline only runs in trusted directories. New repos → no bridge data until the user accepts the trust dialog.
4. **`disableAllHooks: true`** kills statusline too.
5. **`claude --bare`** *might* skip statusline. The flag disables auto-discovery for hooks, skills, plugins, MCP, auto-memory, and `CLAUDE.md` per docs; statusline isn't listed either way — **unverified**.
6. **CC not running → stale data.** Bridge file is only as fresh as the last assistant message. Widget opened first thing in the morning before opening CC → previous-day data.
7. **Script-error blanking.** If our bridge script returns non-zero or hangs, CC blanks the line silently.

`extra_usage` (monthly budget) would also be lost on this path — it's not in the statusline payload at all.

## Hook-bridge feasibility (verified empirically)

Hooks were the most plausible Codex-equivalent: they fire on Claude-Code-internal events, are independent of `statusLine`, allow multiple handlers per event, and don't conflict with user-installed handlers. If the hook stdin payload contained `rate_limits`, we could install a small handler that captures the values into a TokenBBQ-owned snapshot file — passive read for the widget, codex-style.

To verify, a temporary probe was installed in `~/.claude/settings.json` for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`. Each probe wrote the entire stdin payload to a temp file. Two `claude -p` sessions were triggered (one plain prompt, one tool-using prompt). The probe was removed and `settings.json` restored from backup afterward.

Captured top-level fields per event:

| Event | Top-level keys | rate-limit content? |
|---|---|---|
| `SessionStart` | `session_id, transcript_path, cwd, hook_event_name, source` | **None** |
| `UserPromptSubmit` | `session_id, transcript_path, cwd, permission_mode, hook_event_name, prompt` | **None** |
| `PreToolUse` | `session_id, transcript_path, cwd, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id` | **None** |
| `PostToolUse` | `session_id, transcript_path, cwd, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_response, tool_use_id, duration_ms` | **None** |
| `Stop` | `session_id, transcript_path, cwd, permission_mode, effort, hook_event_name, stop_hook_active, last_assistant_message` | **None** |

Conclusion: the documented `rate_limits.{five_hour,seven_day}.used_percentage` fields are exposed only to statusline; tested hook payloads did not include them. (`stream-json` separately emits a sparser `rate_limit_event` per the section above, but no hook event delivers the full statusline-shaped payload.) Plausibly intentional separation — statusline is a read-only display surface; hooks gate tool calls.

### Hook-bridge downsides (for completeness, even though it doesn't work)

If hooks had carried `rate_limits`, the bridge would still have these drawbacks:

1. **Workspace-trust gate per directory.** Same as statusline.
2. **`disableAllHooks: true` kills it.** Some security-conscious orgs default this on.
3. **Stale-by-design.** Hook fires only during active CC sessions — widget opened without a recent CC turn shows yesterday's numbers.
4. **Adds latency to every assistant turn.** CC runs hooks synchronously; even a 50ms hook is 50ms of added per-turn delay.
5. **A crashing hook can affect CC behavior.** PreToolUse crash with the wrong exit code can block tool calls.
6. **Modifies user `settings.json`.** Uninstall path required, schema-version migration on Anthropic changes.
7. **Cross-platform shell quoting.** Same Git-Bash-vs-PowerShell complication as statusline.
8. **No `extra_usage`.** Hook payloads, if they had rate_limits, would mirror statusline's content — monthly budget still gone.
9. **Sequential hook execution.** Multiple handlers on the same event run one after another; a slow user-hook stacks latency on top of ours.

Points 1, 2, 3, 8 are direct carryovers from the statusline path. Points 4–7, 9 would have been hook-specific *additional* costs. The only structural advantage over statusline (no conflict with user-installed statuslines) would have been the lone net win — and it doesn't matter, because the prerequisite (rate_limits in the payload) isn't met.

## Codex consultation

Consulted Codex CLI for missed alternatives. Codex's suggestions:

- `~/.config/claude-code/auth.json` — does not exist on Windows.
- Full JSONL key scan beyond `assistant` entries — verified, no rate-limit content.
- `claude -p --output-format json` envelope — Codex thought no, but I found `rate_limit_event` (above).
- VS Code / JetBrains extension storage — unverified, low probability.
- Local IPC — unverified, no obvious open port.
- MCP, SDK, Admin API — all ruled out.
- OAuth scope-upgrade flow — none documented.

Net new from Codex: zero. The one fresh finding (`rate_limit_event`) came from my own stream-json probe, not Codex's response.

## Options summary

| Option | Friction removed | Drawbacks |
|---|---|---|
| **A. Status quo (sessionKey paste)** | None | Manual paste, fragile cookies on rotation. |
| **B. Statusline bridge** | Paste removed | Stale-by-design, user-statusline conflict, no `extra_usage`, workspace-trust friction, possibly breaks under `--bare`. |
| **C. `claude -p` self-poll** | Paste removed | Recursive: spends quota to read quota. Only `allowed/throttled` status, no `used_percentage`. Real $-charge for API-key users. |
| **F. Browser cookie import** | Paste removed | Cookie-decryption brittle (Chrome App-Bound Encryption); flagged as theft by EDR; per-browser maintenance burden. See dedicated section. |
| **D. Read `.credentials.json` for plan-detection only** | Nothing meaningful | Only adds a free/pro/max gate to the existing UI; doesn't reduce paste friction. |
| **E. Feature request to `anthropics/claude-code`** | All friction, eventually | Asks Anthropic to write `rate_limits` into JSONL like Codex does. ~30min effort, unknown timeline, solves it cleanly for every tool. |
| **G. `anthropic-ratelimit-unified-*` headers via OAuth** | **Paste removed** | Built on undocumented headers + undocumented credentials file. Has `used_percentage` AND `extra_usage` (overage). Live data. ~8 tokens of quota per refresh. Best-data-per-friction of any path tested. |

## Recommendation

**Build Option G with Status quo as fallback. File the feature request alongside.**

Option G is the only path that delivers all three: paste eliminated, `used_percentage` preserved, `extra_usage` preserved. Statusline-bridge loses `extra_usage` and conflicts with user setups; `claude -p` loses `used_percentage`; `.credentials.json`-only adds nothing structural; cookie import is a security regression. Option G's downsides are clear (undocumented headers + undocumented credentials file) but mitigated by graceful fallback to today's sessionKey path.

Pragmatic course:

1. **Implement Option G as primary.** Read OAuth from `~/.claude/.credentials.json`, POST `max_tokens=0` to `/v1/messages`, parse `anthropic-ratelimit-unified-*` headers. Throttle to one call per 60s. Pull `anthropic-organization-id` from the same response — replaces today's `auto_detect_org` flow.
2. **Keep Status quo (A) as fallback.** On any of: missing/expired token, 401/403 response, missing unified headers, schema drift in `.credentials.json` — fall back to today's keyring-based sessionKey path. No regression for existing users.
3. **File the feature request (E) anyway.** Ask Anthropic to either (a) write `rate_limits` + `extra_usage` to JSONL like Codex does, or (b) document `anthropic-ratelimit-unified-*` as stable public API. Either resolves Option G's brittleness long-term.
4. **Migration path.** Existing users keep their sessionKey in keyring as-is. New users who have `claude auth login`'d are detected automatically and never see the paste form. If Option G ever stops working, settings UI surfaces the paste flow as fallback.

### When Option G is *not* the right call

- If Anthropic is known to be about to ship a documented surface for this — wait, don't build on the undocumented one.
- If the user base is mostly Console / API-key users without `claude auth login` setup — they won't have `.credentials.json` populated; Option G provides no benefit, status quo remains.

### Note on what counts as "invasive"

The sessionKey paste is friction, not intrusion: a one-time, user-initiated self-disclosure of a cookie the user already owns, stored in OS keyring. It's a UX wart but structurally minimal — TokenBBQ touches nothing outside its own settings.

The statusline bridge (B) is **structurally more invasive** than the paste it would replace:

- We'd write to `~/.claude/settings.json` — modifying a foreign tool's config
- We'd install a script that runs on every assistant message in CC
- We'd consume the single `statusLine` slot the user might want for their own line
- We'd own a permanent uninstall/upgrade path tied to Anthropic's schema

Paste = friction, removable by deleting the keyring entry. Statusline-install = continuous modification of the user's CC setup. The latter is a bigger ask, not a smaller one.

## Verification trail

- Statusline schema: `code.claude.com/docs/en/statusline`
- CLI subcommands: `code.claude.com/docs/en/cli-reference`
- JSONL inspection: `~/.claude/projects/C--Users-Matthias-TokenBBQ/*.jsonl`, `~/.claude/projects/C--Users-Matthias-NanoGolf-1/*.json` (session-meta)
- `.credentials.json` shape: redacted dump of `claudeAiOauth.{accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier}` plus `mcpOAuth.*`
- Auth probes: 3 curl tests against claude.ai and api.anthropic.com (results in HTTP-status table above)
- API rate-limit-header probe: 5 curl tests against `api.anthropic.com/v1/messages` and `/v1/messages/count_tokens` with the OAuth Bearer token. Confirmed `anthropic-ratelimit-unified-*` headers are emitted only on successful POST with `max_tokens >= 0`. Probed candidate account/limits endpoints (`/v1/me`, `/v1/account`, `/v1/usage`, `/v1/limits`, `/v1/rate_limits`, `/v1/account/limits`, `/v1/account/usage`, `/v1/subscription`, `/v1/plan`, `/v1/quota`, `/v1/oauth/userinfo`) — all returned 404.
- Stream-json probe: `claude -p --verbose --output-format stream-json "say hi"` (cost $0.23, 1 `rate_limit_event` emitted)
- Hook-payload probe: `~/.claude/settings.json` augmented with capture-stdin commands for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`; two `claude -p` sessions triggered; payloads inspected; settings restored from backup; probe files removed.
- Codex consultation: 54k tokens, gpt-5.5, medium reasoning, no net-new findings
