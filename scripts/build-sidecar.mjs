#!/usr/bin/env node
// Compiles the TokenBBQ CLI to a standalone executable and drops it into
// widget/src-tauri/binaries/ with the target-triple suffix Tauri requires
// for `externalBin`. Used by the widget release build.
//
// Dev runs (`npm run widget:dev`) work without this — `commands.rs` falls
// back to `<repo>/dist/index.js` if the bundled binary is missing — but the
// installed widget needs a real standalone exe so end users don't need Node.
//
// Bun is the toolchain: ships its own JS runtime inside a single binary,
// handles `npm`-style imports, and supports cross-platform compile targets.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ENTRY = join(REPO_ROOT, 'src', 'index.ts');
const OUT_DIR = join(REPO_ROOT, 'widget', 'src-tauri', 'binaries');

// Tauri externalBin expects `<basename>-<rustc-host-triple>{ext}`. We match
// the host's rustc triple so this works on any developer machine.
function rustHostTriple() {
  if (process.env.TOKENBBQ_TARGET_TRIPLE) return process.env.TOKENBBQ_TARGET_TRIPLE;
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf-8' });
    const m = /^host:\s*(.+)$/m.exec(out);
    if (m) return m[1].trim();
  } catch {
    // Fall through to platform defaults.
  }
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  return 'x86_64-unknown-linux-gnu';
}

function bunTargetForTriple(triple) {
  if (triple.includes('windows')) return triple.includes('aarch64') ? 'bun-windows-arm64' : 'bun-windows-x64';
  if (triple.includes('apple')) return triple.includes('aarch64') ? 'bun-darwin-arm64' : 'bun-darwin-x64';
  if (triple.includes('linux')) return triple.includes('aarch64') ? 'bun-linux-arm64' : 'bun-linux-x64';
  throw new Error(`No Bun target known for rustc triple ${triple}`);
}

function hasBun() {
  try { execSync('bun --version', { stdio: 'ignore' }); return true; } catch { return false; }
}

function main() {
  const skipIfNoBun = process.argv.includes('--skip-if-no-bun');
  if (!hasBun()) {
    const msg = '[sidecar] Bun not found on PATH. Install Bun (https://bun.sh) to produce a standalone TokenBBQ binary.';
    if (skipIfNoBun) {
      console.warn(msg + ' Skipping; widget dev will use the Node-based dist/index.js fallback.');
      return;
    }
    console.error(msg);
    process.exit(1);
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const triple = rustHostTriple();
  const ext = triple.includes('windows') ? '.exe' : '';
  const outFile = join(OUT_DIR, `tokenbbq-${triple}${ext}`);
  const bunTarget = bunTargetForTriple(triple);

  console.log(`[sidecar] Compiling with Bun → ${outFile} (target=${bunTarget})`);
  execSync(
    `bun build --compile --minify --target=${bunTarget} ${JSON.stringify(ENTRY)} --outfile ${JSON.stringify(outFile)}`,
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
}

main();
