# Contributing to TokenBBQ

Thanks for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/offbyone1/tokenbbq.git
cd tokenbbq
npm install
npm run dev
npm run test
npm run build
```

`npm run dev` starts the local dashboard with `tsx`. Pass dashboard options after `--`, for example:

```bash
npm run dev -- --port=8080 --no-open
```

## Project Structure

```text
src/
|-- index.ts          # Dashboard launcher
|-- types.ts          # Shared type definitions
|-- loaders/          # Data loaders, one per tool
|   |-- index.ts      # Loader orchestrator
|   |-- claude.ts     # Claude Code
|   |-- codex.ts      # OpenAI Codex
|   |-- gemini.ts     # Gemini
|   |-- opencode.ts   # OpenCode
|   |-- amp.ts        # Amp
|   `-- pi.ts         # Pi-Agent
|-- pricing.ts        # LiteLLM pricing engine
|-- aggregator.ts     # Data aggregation
|-- server.ts         # Hono web server
`-- dashboard.ts      # HTML dashboard template
```

## Adding a New Loader

To add support for a new AI coding tool:

1. Create `src/loaders/<toolname>.ts`.
2. Implement a `load<Tool>Events()` function that returns `UnifiedTokenEvent[]`.
3. Register it in `src/loaders/index.ts`.
4. Add the source to the `Source` type in `src/types.ts`.
5. Add color and label mappings in `src/types.ts`.

Each loader should:

- Auto-detect whether the tool's data directory exists.
- Return an empty array if not found.
- Normalize all data to the `UnifiedTokenEvent` interface.
- Deduplicate entries where appropriate.
- Sort events by timestamp.

## Pull Request Process

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/my-feature`).
3. Make your changes.
4. Ensure `npm run lint`, `npm run test`, and `npm run build` succeed.
5. Open a pull request with a clear description.

## Code Style

- TypeScript with strict mode.
- ESM modules (`import`/`export`).
- No unnecessary dependencies.
- Keep the package focused on the dashboard runtime.

## Reporting Bugs

Please open an issue with:

- Your OS and Node.js version.
- Which AI tools you have installed.
- Steps to reproduce the issue.
- Expected vs actual behavior.
