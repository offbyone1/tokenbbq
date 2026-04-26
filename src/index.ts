import pc from 'picocolors';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadAll } from './loaders/index.js';
import { enrichCosts } from './pricing.js';
import { buildDashboardData } from './aggregator.js';
import { startServer } from './server.js';
import { printDailyTable, printMonthlyTable, printSummary } from './cli-output.js';
import { loadStore, appendEvents, type StoreState } from './store.js';

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	const command = args.find((a) => !a.startsWith('-')) ?? 'dashboard';
	const port = Number(args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 3000);
	const json = args.includes('--json');
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

${pc.cyan('Options:')}
  --port=<n>     Server port (default: 3000)
  --json         Output raw JSON data
  --no-open      Don't auto-open browser
  -h, --help     Show this help

${pc.cyan('Supported Tools:')}
  Claude Code    ~/.claude/projects/**/*.jsonl
  Codex          ~/.codex/sessions/**/*.jsonl
  Gemini         ~/.gemini/tmp/**/chats/session-*.json
  OpenCode       ~/.local/share/opencode/storage/**/*.json
  Amp            ~/.local/share/amp/threads/**/*.json
  Pi-Agent       ~/.pi/agent/sessions/**/*.jsonl
`);
}

function getDashboardBrandLogoPath(): string | null {
	const envPath = (process.env.TOKENBBQ_LOGO_PATH ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(resolved)) return resolved;
	}

	const candidates = [
		path.join(homedir(), 'Downloads', 'tokenbbq.png'),
		'C:\\download\\tokenbbq.png',
		'C:\\Download\\tokenbbq.png',
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return null;
}

async function main(): Promise<void> {
	const { command, port, json, noOpen, help } = parseArgs(process.argv);

	if (help) {
		printHelp();
		return;
	}

	const log = json ? () => {} : console.error.bind(console);

	log('');
	log(pc.bold('  🔥 TokenBBQ'));
	log(pc.dim('  Scanning for AI tool usage data...\n'));

	const store: StoreState = loadStore();
	const { events: scanned, detected } = await loadAll(json);
	const added = appendEvents(store, scanned);

	if (store.events.length === 0) {
		console.error(pc.yellow('\n  No usage data found.'));
		console.error(pc.dim('  Make sure you have used at least one supported AI coding tool.'));
		console.error(pc.dim('  Run `npx tokenbbq --help` for supported tool paths.\n'));
		return;
	}

	log(pc.dim(`\n  Total: ${store.events.length.toLocaleString()} events in store (+ ${added.length} new from ${detected.length} source(s))\n`));
	log(pc.dim('  Calculating costs...'));
	await enrichCosts(store.events);

	const data = buildDashboardData(store.events);

	if (json) {
		process.stdout.write(JSON.stringify(data, null, 2));
		return;
	}

	const reloadDashboardData = async () => {
		const { events: fresh } = await loadAll(true);
		const addedNow = appendEvents(store, fresh);
		if (addedNow.length > 0) await enrichCosts(addedNow);
		return buildDashboardData(store.events);
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
			await startServer(data, {
				port,
				open: !noOpen,
				getData: reloadDashboardData,
				brandLogoPath: getDashboardBrandLogoPath(),
			});
			break;
	}
}

main().catch((err) => {
	console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
	process.exit(1);
});
