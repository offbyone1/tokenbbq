import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
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

export interface ServerHandle {
	/**
	 * Force a fresh data reload and broadcast an SSE update to all
	 * subscribed clients. Safe to call repeatedly; the underlying readData
	 * coalesces overlapping calls.
	 */
	notifyDataChanged(): Promise<void>;
	/** Close the underlying HTTP server. Called by the CLI on shutdown. */
	stop(): void;
}

export async function startServer(
	data: DashboardData,
	options: {
		port: number;
		open: boolean;
		getData?: () => Promise<DashboardData>;
		brandLogoPath?: string | null;
	},
): Promise<ServerHandle> {
	const app = new Hono();
	let currentData = data;
	let refreshInFlight: Promise<DashboardData> | null = null;
	let lastRefreshAt = Date.now();

	type Subscriber = (id: number) => Promise<void>;
	const subscribers = new Set<Subscriber>();
	let updateId = 0;

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

	function broadcast(): void {
		const id = ++updateId;
		// Snapshot subscribers — a slow client can't block fast ones, and
		// failed sends evict the subscriber so we don't accumulate dead ones.
		for (const send of [...subscribers]) {
			send(id).catch(() => subscribers.delete(send));
		}
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

	app.get('/api/stream', (c) => {
		return streamSSE(c, async (stream) => {
			let alive = true;
			const send: Subscriber = async (id) => {
				if (!alive) return;
				await stream.writeSSE({ event: 'update', data: String(id), id: String(id) });
			};
			subscribers.add(send);
			stream.onAbort(() => {
				alive = false;
				subscribers.delete(send);
			});

			// Initial hello so EventSource fires onopen reliably across browsers.
			await stream.writeSSE({ event: 'hello', data: '' });

			// Heartbeat — keeps proxies and idle TCP from killing the stream.
			while (alive) {
				await stream.sleep(30000);
				if (!alive) break;
				try {
					await stream.writeSSE({ event: 'heartbeat', data: '' });
				} catch {
					alive = false;
					subscribers.delete(send);
				}
			}
		});
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

	return {
		notifyDataChanged: async () => {
			await readData(true);
			broadcast();
		},
		stop: () => {
			server.close();
		},
	};
}
