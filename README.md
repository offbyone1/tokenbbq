# 🔥 TokenBBQ

[![npm version](https://img.shields.io/npm/v/tokenbbq.svg)](https://www.npmjs.com/package/tokenbbq)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Visualize token usage and costs across all your AI coding tools** — Claude Code, Codex, OpenCode, Amp, Pi-Agent — in one beautiful dashboard.

## Quick Start

```bash
npx tokenbbq@latest
```

That's it. No install, no config, no API keys. TokenBBQ scans your local AI tool data and opens a dashboard in your browser.

## What It Does

TokenBBQ reads the local usage files that AI coding tools store on your machine and shows you:

- **Total cost and token usage** across all tools
- **Daily timeline** of token consumption, stacked by provider
- **Cost breakdown** by provider (donut chart)
- **Top models** ranked by cost
- **Monthly trend** to track spending over time
- **Activity heatmap** (GitHub-style, last 90 days)
- **Detailed daily table** with per-day breakdown

## Supported Tools

| Tool | Data Location | Format |
|------|--------------|--------|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | JSONL |
| **Codex** | `~/.codex/sessions/**/*.jsonl` | JSONL |
| **OpenCode** | `~/.local/share/opencode/storage/**/*.json` | JSON |
| **Amp** | `~/.local/share/amp/threads/**/*.json` | JSON |
| **Pi-Agent** | `~/.pi/agent/sessions/**/*.jsonl` | JSONL |

## CLI Commands

```bash
npx tokenbbq                # Open dashboard in browser (default)
npx tokenbbq daily          # Daily usage table in terminal
npx tokenbbq monthly        # Monthly usage table in terminal
npx tokenbbq summary        # Compact summary
npx tokenbbq --json         # Export all data as JSON
npx tokenbbq --port=8080    # Use a different port
npx tokenbbq --no-open      # Don't auto-open browser
npx tokenbbq --help         # Show help
```

## How It Works

1. Scans your filesystem for known AI tool data directories
2. Parses JSONL/JSON files to extract token usage events
3. Fetches current model pricing from [LiteLLM](https://github.com/BerriAI/litellm)
4. Calculates costs and aggregates data
5. Serves an interactive dashboard on `localhost:3000`

All data stays local. Nothing is sent to any server.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and how to add support for new tools.

## License

[MIT](LICENSE) © [offbyone1](https://github.com/offbyone1)
