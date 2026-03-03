# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2025-03-03

### Added

- **Light/Dark Mode Toggle** - Switch between themes with persistent preference
- **Brand Logo Customization** - Custom logo via `TOKENBBQ_LOGO_PATH` environment variable
- **Live Auto-Refresh** - Dashboard updates every 5 seconds automatically
- **Time Filter** - Filter data by time range (7/30/90/180/365 days or all time)
- **Expandable Daily Rows** - Click to reveal detailed source and model breakdowns
- **Sortable Tables** - Click column headers to sort with visual indicators
- **Project Tracking** - New project-level aggregations and breakdowns
- **OpenCode SQLite Support** - Reads directly from `opencode.db` for better accuracy

### Changed

- **Enhanced Aggregations** - Added daily-by-source, daily-by-model, and source-model breakdowns
- **Improved Heatmap** - Hover effects with scale animation and better tooltips
- **Codex Token Calculation** - Fixed token counting logic to avoid double-counting

### Fixed

- **XSS Prevention** - JSON output properly escaped for security

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
