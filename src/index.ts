import pc from 'picocolors';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadAll, getAllWatchPaths } from './loaders/index.js';
import { enrichCosts } from './pricing.js';
import { buildDashboardData } from './aggregator.js';
import { startServer } from './server.js';
import { startToolWatcher } from './watcher.js';
import { loadStore, appendEvents, type StoreState } from './store.js';
import { mergeFreshSourceEvents } from './event-merge.js';

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	const command = args.find((a) => !a.startsWith('-')) ?? null;
	const portArg = args.find((a) => a.startsWith('--port='))?.split('=')[1];
	const port = Number(portArg ?? 3000);
	const noOpen = args.includes('--no-open');
	const help = args.includes('--help') || args.includes('-h');
	const unknownOptions = args.filter((a) => (
		a.startsWith('-') &&
		!a.startsWith('--port=') &&
		a !== '--no-open' &&
		a !== '--help' &&
		a !== '-h'
	));
	return { command, port, noOpen, help, unknownOptions };
}

function printHelp(): void {
	console.log(`
${pc.bold('TokenBBQ')} - AI coding tool usage dashboard

${pc.cyan('Usage:')}
  npx tokenbbq                Open the local dashboard in your browser

${pc.cyan('Options:')}
  --port=<n>     Server port (default: 3000)
  --no-open      Don't auto-open browser
  -h, --help     Show this help

${pc.cyan('Supported Tools:')}
  Claude Code    ~/.claude/projects/**/*.jsonl
  Codex          ~/.codex/sessions/**/*.jsonl
  Gemini         ~/.gemini/tmp/**/chats/session-*.json
  OpenCode       ~/.local/share/opencode/opencode.db (SQLite, all platforms)
  Amp            Linux:   ~/.local/share/amp/threads/**/*.json
                 macOS:   ~/Library/Application Support/amp/threads/**/*.json
                 Windows: %APPDATA%\\amp\\threads\\**\\*.json
  Pi-Agent       ~/.pi/agent/sessions/**/*.jsonl
`);
}

// Only honour an explicit TOKENBBQ_LOGO_PATH. Without it, the dashboard
// falls back to its inline SVG flame/coin mark.
function getDashboardBrandLogoPath(): string | null {
	const envPath = (process.env.TOKENBBQ_LOGO_PATH ?? '').trim();
	if (envPath === '') return null;
	const resolved = path.resolve(envPath);
	return existsSync(resolved) ? resolved : null;
}

async function main(): Promise<void> {
	const { command, port, noOpen, help, unknownOptions } = parseArgs(process.argv);

	if (help) {
		printHelp();
		return;
	}

	if (unknownOptions.length > 0) {
		console.error(pc.red('Error:'), `unknown option '${unknownOptions[0]}'. TokenBBQ now starts the dashboard only.`);
		console.error(pc.dim('Run `npx tokenbbq --help` for supported options.'));
		process.exit(1);
	}

	if (command) {
		console.error(pc.red('Error:'), `unknown argument '${command}'. TokenBBQ now starts the dashboard only.`);
		console.error(pc.dim('Run `npx tokenbbq --help` for supported options.'));
		process.exit(1);
	}

	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		console.error(pc.red('Error:'), '--port must be a number between 1 and 65535.');
		process.exit(1);
	}

	console.error('');
	console.error(pc.bold('  TokenBBQ'));
	console.error(pc.dim('  Scanning for AI tool usage data...\n'));

	const store: StoreState = loadStore();
	const { events: scanned, detected, errors, codexRateLimits } = await loadAll(false);
	// Codex emits cumulative-total events that we re-derive deltas from on
	// every scan; persisting them double-counts on the next run. Persist
	// every other source as before, and merge fresh codex events on top
	// of the store at read time only.
	const persistable = scanned.filter((e) => e.source !== 'codex');
	const added = appendEvents(store, persistable);
	let workingEvents = mergeFreshSourceEvents(store.events, scanned, ['codex']);

	for (const e of errors) {
		console.error(pc.yellow(`  warn: loader '${e.source}' failed: ${e.error}`));
	}

	if (workingEvents.length === 0) {
		console.error(pc.yellow('\n  No usage data found yet.'));
		console.error(pc.dim('  Opening the dashboard anyway; it will refresh when supported tool data appears.\n'));
	} else {
		console.error(pc.dim(`\n  Total: ${workingEvents.length.toLocaleString()} events (+ ${added.length} new persisted from ${detected.length} source(s))\n`));
		console.error(pc.dim('  Calculating costs...'));
		await enrichCosts(workingEvents);
	}

	const data = buildDashboardData(workingEvents, codexRateLimits);

	const reloadDashboardData = async () => {
		const { events: fresh, codexRateLimits: freshLimits } = await loadAll(true);
		const addedNow = appendEvents(store, fresh.filter((e) => e.source !== 'codex'));
		workingEvents = mergeFreshSourceEvents(store.events, fresh, ['codex']);
		if (addedNow.length > 0) await enrichCosts(addedNow);
		await enrichCosts(workingEvents.filter((e) => e.source === 'codex'));
		return buildDashboardData(workingEvents, freshLimits);
	};

	const handle = await startServer(data, {
		port,
		open: !noOpen,
		getData: reloadDashboardData,
		brandLogoPath: getDashboardBrandLogoPath(),
	});

	const watcher = startToolWatcher(getAllWatchPaths(), () => {
		handle.notifyDataChanged().catch(() => {});
	});
	if (watcher.watching > 0) {
		console.error(pc.dim(`  Live-watching ${watcher.watching} tool director${watcher.watching === 1 ? 'y' : 'ies'} for changes.\n`));
	}

	const shutdown = () => {
		watcher.close();
		handle.stop();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main().catch((err) => {
	console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
	process.exit(1);
});
