import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import type { DashboardData } from './types.js';
import { renderDashboard } from './dashboard.js';

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const srv = createServer();
		srv.once('error', () => resolve(false));
		srv.once('listening', () => {
			srv.close(() => resolve(true));
		});
		srv.listen(port);
	});
}

async function findFreePort(preferred: number): Promise<number> {
	for (let port = preferred; port < preferred + 20; port++) {
		if (await isPortFree(port)) return port;
	}
	return 0;
}

export async function startServer(
	data: DashboardData,
	options: {
		port: number;
		open: boolean;
		getData?: () => Promise<DashboardData>;
		brandLogoPath?: string | null;
	},
): Promise<void> {
	const app = new Hono();
	let currentData = data;
	let refreshInFlight: Promise<DashboardData> | null = null;
	let lastRefreshAt = Date.now();

	async function readData(force = false): Promise<DashboardData> {
		if (!options.getData) return currentData;

		const now = Date.now();
		if (!force && now - lastRefreshAt < 3000) return currentData;
		if (refreshInFlight) return refreshInFlight;

		refreshInFlight = options
			.getData()
			.then((next) => {
				currentData = next;
				lastRefreshAt = Date.now();
				return currentData;
			})
			.catch(() => currentData)
			.finally(() => {
				refreshInFlight = null;
			});

		return refreshInFlight;
	}

	app.get('/', async (c) => {
		return c.html(
			renderDashboard(await readData(), {
				brandLogoUrl: options.brandLogoPath ? '/brand-logo' : null,
			}),
		);
	});

	app.get('/api/data', async (c) => {
		return c.json(await readData(true));
	});

	app.get('/brand-logo', async (c) => {
		if (!options.brandLogoPath) return c.notFound();
		try {
			const file = await readFile(options.brandLogoPath);
			return c.body(file, 200, {
				'Content-Type': 'image/png',
				'Cache-Control': 'no-cache, no-store, must-revalidate',
			});
		} catch {
			return c.notFound();
		}
	});

	const port = await findFreePort(options.port);
	if (port === 0) {
		console.error(`  Could not find a free port (tried ${options.port}–${options.port + 19}).`);
		process.exit(1);
	}

	const server = serve({ fetch: app.fetch, port }, (info) => {
		const url = `http://localhost:${info.port}`;
		console.log(`\n  Dashboard running at ${url}\n`);
		if (port !== options.port) {
			console.log(`  (Port ${options.port} was in use, using ${port} instead)\n`);
		}
		console.log('  Press Ctrl+C to stop.\n');

		if (options.open) {
			import('open').then((mod) => mod.default(url)).catch(() => {});
		}
	});

	process.on('SIGINT', () => {
		server.close();
		process.exit(0);
	});

	process.on('SIGTERM', () => {
		server.close();
		process.exit(0);
	});
}
