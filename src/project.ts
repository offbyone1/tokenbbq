import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const VCS_MARKERS = ['.git', '.hg', '.svn'];
const MANIFEST_MARKERS = [
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml',
];
const CSPROJ_RE = /\.csproj$/i;

function hasMarker(dir: string): boolean {
  for (const m of VCS_MARKERS) {
    if (existsSync(path.join(dir, m))) return true;
  }
  for (const m of MANIFEST_MARKERS) {
    if (existsSync(path.join(dir, m))) return true;
  }
  try {
    for (const entry of readdirSync(dir)) {
      if (CSPROJ_RE.test(entry)) return true;
    }
  } catch {
    // directory unreadable — treat as "no marker"
  }
  return false;
}

const cache = new Map<string, { root: string; name: string }>();

export function resolveProjectRoot(cwd: string): { root: string; name: string } {
  const normalized = path.resolve(cwd);
  const cached = cache.get(normalized);
  if (cached) return cached;

  const home = path.resolve(homedir());
  const parsed = path.parse(normalized);
  const driveRoot = parsed.root;

  // Walk from cwd up to (but not including) the boundary.
  // Track the OUTERMOST directory that has any marker.
  let outermostMarkerDir: string | null = null;
  let current = normalized;
  while (true) {
    if (current === home || current === driveRoot) break;
    try {
      if (statSync(current).isDirectory() && hasMarker(current)) {
        outermostMarkerDir = current; // overwrite so the last (=outermost) sticks
      }
    } catch {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const root = outermostMarkerDir ?? normalized;
  const result = { root, name: path.basename(root) || root };
  cache.set(normalized, result);
  return result;
}
