import Table from 'cli-table3';
import pc from 'picocolors';
import type { DailyAggregation, MonthlyAggregation, DashboardData } from './types.js';
import { SOURCE_LABELS, totalTokenCount } from './types.js';

function fmt(n: number): string {
	return n.toLocaleString('en-US');
}

function fmtUSD(n: number): string {
	return `$${n.toFixed(2)}`;
}

function shortModel(m: string): string {
	return m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export function printDailyTable(data: DashboardData): void {
	const table = new Table({
		head: ['Date', 'Sources', 'Models', 'Input', 'Output', 'Total', 'Cost'].map((h) =>
			pc.cyan(h),
		),
		colAligns: ['left', 'left', 'left', 'right', 'right', 'right', 'right'],
	});

	for (const day of data.daily) {
		const sources = day.sources.map((s) => SOURCE_LABELS[s]).join(', ');
		const models = day.models.map(shortModel).join(', ');
		const total = totalTokenCount(day.tokens);

		table.push([
			day.date,
			sources,
			models,
			fmt(day.tokens.input),
			fmt(day.tokens.output),
			fmt(total),
			pc.yellow(fmtUSD(day.costUSD)),
		]);
	}

	const totals = data.totals;
	table.push([
		pc.yellow('Total'),
		'',
		'',
		pc.yellow(fmt(totals.tokens.input)),
		pc.yellow(fmt(totals.tokens.output)),
		pc.yellow(fmt(totals.totalTokens)),
		pc.yellow(fmtUSD(totals.costUSD)),
	]);

	console.log(table.toString());
}

export function printMonthlyTable(data: DashboardData): void {
	const table = new Table({
		head: ['Month', 'Sources', 'Input', 'Output', 'Total', 'Cost'].map((h) => pc.cyan(h)),
		colAligns: ['left', 'left', 'right', 'right', 'right', 'right'],
	});

	for (const month of data.monthly) {
		const sources = month.sources.map((s) => SOURCE_LABELS[s]).join(', ');
		const total = totalTokenCount(month.tokens);

		table.push([
			month.month,
			sources,
			fmt(month.tokens.input),
			fmt(month.tokens.output),
			fmt(total),
			pc.yellow(fmtUSD(month.costUSD)),
		]);
	}

	const totals = data.totals;
	table.push([
		pc.yellow('Total'),
		'',
		pc.yellow(fmt(totals.tokens.input)),
		pc.yellow(fmt(totals.tokens.output)),
		pc.yellow(fmt(totals.totalTokens)),
		pc.yellow(fmtUSD(totals.costUSD)),
	]);

	console.log(table.toString());
}

export function printSummary(data: DashboardData): void {
	const t = data.totals;
	console.log('');
	console.log(pc.bold('  Summary'));
	console.log(pc.dim('  ─────────────────────────'));
	console.log(`  Total Cost:   ${pc.yellow(fmtUSD(t.costUSD))}`);
	console.log(`  Total Tokens: ${pc.blue(fmt(t.totalTokens))}`);
	console.log(`  Active Days:  ${pc.green(String(t.activeDays))}`);
	console.log(`  Top Model:    ${pc.magenta(shortModel(t.topModel))}`);
	if (t.topSource) {
		console.log(`  Top Source:   ${pc.cyan(SOURCE_LABELS[t.topSource])}`);
	}
	console.log('');
}
