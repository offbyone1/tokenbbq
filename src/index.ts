import pc from 'picocolors';
import { loadAll } from './loaders/index.js';
import { enrichCosts } from './pricing.js';
import { buildDashboardData } from './aggregator.js';
import { startServer } from './server.js';
import { printDailyTable, printMonthlyTable, printSummary } from './cli-output.js';

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
  OpenCode       ~/.local/share/opencode/storage/**/*.json
  Amp            ~/.local/share/amp/threads/**/*.json
  Pi-Agent       ~/.pi/agent/sessions/**/*.jsonl
`);
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

	const { events, detected, errors } = await loadAll(json);

	if (events.length === 0) {
		console.error(pc.yellow('\n  No usage data found.'));
		console.error(pc.dim('  Make sure you have used at least one supported AI coding tool.'));
		console.error(pc.dim('  Run `npx tokenbbq --help` for supported tool paths.\n'));
		return;
	}

	log(pc.dim(`\n  Total: ${events.length.toLocaleString()} events from ${detected.length} source(s)\n`));
	log(pc.dim('  Calculating costs...'));
	await enrichCosts(events);

	const data = buildDashboardData(events);

	if (json) {
		process.stdout.write(JSON.stringify(data, null, 2));
		return;
	}

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
			await startServer(data, { port, open: !noOpen });
			break;
	}
}

main().catch((err) => {
	console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
	process.exit(1);
});
