# TokenBBQ

[![npm version](https://img.shields.io/npm/v/tokenbbq.svg)](https://www.npmjs.com/package/tokenbbq)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**See what your AI coding tools actually cost you.** TokenBBQ reads local usage data from Claude Code, Codex, Gemini, OpenCode, Amp, and Pi-Agent and shows it all in one dashboard.

## Quick Start

```bash
npx tokenbbq@latest
```

No install, no config, no API keys. Opens a dashboard in your browser at `localhost:3000`.

## Dashboard Features

- **Daily cost timeline** — stacked bar chart by provider
- **Cost breakdown** — donut chart showing spend per tool
- **Top models** — ranked by total cost
- **Monthly trend** — line chart of spending over time
- **Activity heatmap** — GitHub-style, last 90 days
- **Detailed daily table** — expandable rows with per-source and per-model breakdowns
- **Light / Dark mode** — toggle with persistent preference
- **Time filter** — 7 / 30 / 90 / 180 / 365 days or all time
- **Sortable columns** — click any table header to sort
- **Live auto-refresh** — dashboard updates every 5 seconds

## Supported Tools

| Tool | Data Location | Format |
|------|--------------|--------|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | JSONL |
| **Codex** | `~/.codex/sessions/**/*.jsonl` | JSONL |
| **Gemini** | `~/.gemini/tmp/**/chats/session-*.json` | JSON |
| **OpenCode** | `~/.local/share/opencode/` | JSON + SQLite |
| **Amp** | `~/.local/share/amp/threads/**/*.json` | JSON |
| **Pi-Agent** | `~/.pi/agent/sessions/**/*.jsonl` | JSONL |

On Windows, `~` resolves to `C:\Users\<name>`. Claude Code, Codex, and Gemini use the same paths cross-platform. OpenCode, Amp, and Pi-Agent default to Linux/macOS paths — set `GEMINI_DIR`, `OPENCODE_DATA_DIR`, `AMP_DATA_DIR`, or `PI_AGENT_DIR` environment variables to override.

## CLI

```bash
npx tokenbbq                # Dashboard in browser (default)
npx tokenbbq daily          # Daily table in terminal
npx tokenbbq monthly        # Monthly table in terminal
npx tokenbbq summary        # Compact summary
npx tokenbbq --json         # JSON to stdout
npx tokenbbq --port=8080    # Custom port
npx tokenbbq --no-open      # Don't auto-open browser
npx tokenbbq --help         # Show help
```

## How It Works

1. Scans your filesystem for known AI tool data directories
2. Parses JSONL / JSON / SQLite files to extract token usage events
3. Fetches current model pricing from [LiteLLM](https://github.com/BerriAI/litellm) (with offline fallback)
4. Calculates costs and aggregates by day, month, source, and model
5. Serves an interactive dashboard on localhost

All data stays on your machine. The only network request is fetching model prices.

## Credits

TokenBBQ builds on the data-loading patterns from [ccusage](https://github.com/ryoppippi/ccusage) by [@ryoppippi](https://github.com/ryoppippi). Thanks for the excellent groundwork on parsing Claude Code, Codex, OpenCode, Amp, and Pi-Agent usage data.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and how to add support for new tools.

## Support

If TokenBBQ saves you from bill shock, consider buying me a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M11VBHXH)

## License

[MIT](LICENSE) © [offbyone1](https://github.com/offbyone1)
