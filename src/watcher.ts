import { watch, type FSWatcher } from 'node:fs';

export interface WatcherHandle {
	close(): void;
	/** Number of paths actually being watched (for diagnostics). */
	readonly watching: number;
}

export interface StartWatcherOptions {
	debounceMs?: number;
	onError?: (path: string, err: unknown) => void;
}

/**
 * Watch a list of directories recursively. Coalesces bursts of file events
 * into a single onChange call after `debounceMs` of quiet. Recursive
 * fs.watch is supported on macOS, Windows, and Linux (Node 20+); we treat
 * setup failures per-path as non-fatal — a missing or unwatchable path
 * just falls back to the existing periodic refresh.
 */
export function startToolWatcher(
	paths: string[],
	onChange: () => void,
	opts: StartWatcherOptions = {},
): WatcherHandle {
	const debounceMs = opts.debounceMs ?? 500;
	const watchers: FSWatcher[] = [];
	let timer: NodeJS.Timeout | null = null;

	const trigger = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			try {
				onChange();
			} catch {
				// ignore — onChange should be self-defending
			}
		}, debounceMs);
	};

	for (const p of paths) {
		try {
			const w = watch(p, { recursive: true }, () => trigger());
			w.on('error', (err) => {
				opts.onError?.(p, err);
			});
			watchers.push(w);
		} catch (err) {
			opts.onError?.(p, err);
		}
	}

	return {
		close() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			for (const w of watchers) {
				try {
					w.close();
				} catch {
					// already closed or detached — ignore
				}
			}
		},
		get watching() {
			return watchers.length;
		},
	};
}
