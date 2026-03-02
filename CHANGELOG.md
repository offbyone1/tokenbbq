# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2025-03-02

### Added

- Initial release
- Browser-based dashboard with Chart.js visualizations
- Data loaders for Claude Code, Codex, OpenCode, Amp, and Pi-Agent
- LiteLLM-based pricing engine with offline fallback
- CLI commands: `daily`, `monthly`, `summary`, `--json`
- Summary cards: total cost, total tokens, active days, top model
- Daily token usage timeline (stacked by provider)
- Cost breakdown donut chart by provider
- Top models ranking by cost
- Monthly cost trend line chart
- GitHub-style activity heatmap (last 90 days)
- Detailed daily breakdown table
