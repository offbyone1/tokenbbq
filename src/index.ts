import pc from 'picocolors';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadAll, getAllWatchPaths } from './loaders/index.js';
import { enrichCosts } from './pricing.js';
import { buildDashboardData } from './aggregator.js';
import { startServer } from './server.js';
import { startToolWatcher } from './watcher.js';
import { printDailyTable, printMonthlyTable, printSummary } from './cli-output.js';
import { loadStore, appendEvents, type StoreState } from './store.js';
import { mergeFreshSourceEvents } from './event-merge.js';

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	const command = args.find((a) => !a.startsWith('-')) ?? 'dashboard';
	const port = Number(args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 3000);
	// `scan` is a headless one-shot: emit DashboardData JSON to stdout and exit.
	// It implies --json so embedders (e.g. the desktop widget sidecar) only need the verb.
	const json = args.includes('--json') || command === 'scan';
	const noOpen = args.includes('--no-open');
	const help = args.includes('--help') || args.includes('-h');
	return { command, port, json, noOpen, help };
}

function printHelp(): void {
	console.log(`
${pc.bold('TokenBBQ')} — AI Coding Tool Usage Dashboard

${pc.cyan('Usage:')}
  npx tokenbbq                Open dashboard in browser (default)
  npx tokenbbq daily          Show daily usage table in terminal
  npx tokenbbq monthly        Show monthly usage table in terminal
  npx tokenbbq summary        Show compact summary
  npx tokenbbq scan           Print DashboardData JSON to stdout and exit
                              (headless one-shot; for embedding in other tools)

${pc.cyan('Options:')}
  --port=<n>     Server port (default: 3000)
  --json         Output raw JSON data
  --no-open      Don't auto-open browser
  -h, --help     Show this help

${pc.cyan('Supported Tools:')}
  Claude Code    ~/.claude/projects/**/*.jsonl
  Codex          ~/.codex/sessions/**/*.jsonl
  Gemini         ~/.gemini/tmp/**/chats/session-*.json
  OpenCode       ~/.local/share/opencode/opencode.db (SQLite)
  Amp            ~/.local/share/amp/threads/**/*.json
  Pi-Agent       ~/.pi/agent/sessions/**/*.jsonl
`);
}

// Only honour an explicit TOKENBBQ_LOGO_PATH. Without it, the dashboard
// falls back to its inline SVG flame/coin mark — no need to hunt for a
// PNG in the user's Downloads folder.
function getDashboardBrandLogoPath(): string | null {
	const envPath = (process.env.TOKENBBQ_LOGO_PATH ?? '').trim();
	if (envPath === '') return null;
	const resolved = path.resolve(envPath);
	return existsSync(resolved) ? resolved : null;
}

async function main(): Promise<void> {
	const { command, port, json, noOpen, help } = parseArgs(process.argv);

	// Don't crash if a downstream consumer (e.g. `tokenbbq scan | head`) closes
	// the pipe before we finish writing — relevant for the headless scan path
	// where the JSON payload can be large.
	process.stdout.on('error', (err) => {
		if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0);
	});

	if (help) {
		printHelp();
		return;
	}

	const log = json ? () => {} : console.error.bind(console);

	log('');
	log(pc.bold('  🔥 TokenBBQ'));
	log(pc.dim('  Scanning for AI tool usage data...\n'));

	const store: StoreState = loadStore();
	const { events: scanned, detected, errors, codexRateLimits } = await loadAll(json);
	const persistable = scanned.filter((e) => e.source !== 'codex');
	const added = appendEvents(store, persistable);
	let workingEvents = mergeFreshSourceEvents(store.events, scanned, ['codex']);

	// Surface loader failures rather than silently dropping them. In JSON
	// mode (incl. `scan`) we route to stderr so structured stdout stays
	// machine-parseable.
	for (const e of errors) {
		console.error(pc.yellow(`  warn: loader '${e.source}' failed: ${e.error}`));
	}

	if (workingEvents.length === 0) {
		// In JSON mode (incl. `scan`) emit a valid empty DashboardData rather than
		// returning silently — embedders can then unconditionally JSON.parse stdout.
		if (json) {
			process.stdout.write(JSON.stringify(buildDashboardData([], codexRateLimits), null, 2));
			return;
		}
		console.error(pc.yellow('\n  No usage data found.'));
		console.error(pc.dim('  Make sure you have used at least one supported AI coding tool.'));
		console.error(pc.dim('  Run `npx tokenbbq --help` for supported tool paths.\n'));
		return;
	}

	log(pc.dim(`\n  Total: ${workingEvents.length.toLocaleString()} events (+ ${added.length} new persisted from ${detected.length} source(s))\n`));
	log(pc.dim('  Calculating costs...'));
	await enrichCosts(workingEvents);

	const data = buildDashboardData(workingEvents, codexRateLimits);

	if (json) {
		process.stdout.write(JSON.stringify(data, null, 2));
		return;
	}

	const reloadDashboardData = async () => {
		const { events: fresh, codexRateLimits: freshLimits } = await loadAll(true);
		const addedNow = appendEvents(store, fresh.filter((e) => e.source !== 'codex'));
		workingEvents = mergeFreshSourceEvents(store.events, fresh, ['codex']);
		if (addedNow.length > 0) await enrichCosts(addedNow);
		await enrichCosts(workingEvents.filter((e) => e.source === 'codex'));
		return buildDashboardData(workingEvents, freshLimits);
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
				log(pc.dim(`  Live-watching ${watcher.watching} tool director${watcher.watching === 1 ? 'y' : 'ies'} for changes.\n`));
			}
			// Single shutdown path so the watcher actually gets a chance to close.
			// Previously startServer registered its own SIGINT handler that called
			// process.exit(0) before the watcher.close() handler below could run.
			const shutdown = () => {
				watcher.close();
				handle.stop();
				process.exit(0);
			};
			process.on('SIGINT', shutdown);
			process.on('SIGTERM', shutdown);
			break;
	}
}

main().catch((err) => {
	console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
	process.exit(1);
});
