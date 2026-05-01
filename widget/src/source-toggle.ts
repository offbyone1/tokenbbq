/**
 * User preference for which sources the pill should display.
 *   "claude" — Claude Code Subscription only (default; current behavior)
 *   "codex"  — Codex only
 *   "both"   — stacked dual-mode (pill is taller)
 *   "none"   — both toggles off; pill shows empty placeholder boxes
 */
export type SourceMode = 'claude' | 'codex' | 'both' | 'none';

const STORAGE_KEY_CLAUDE = 'tokenbbq-show-claude';
const STORAGE_KEY_CODEX = 'tokenbbq-show-codex';

export interface SourceToggleState {
  claude: boolean;
  codex: boolean;
}

/**
 * Read the toggle state from localStorage. Defaults: Claude on, Codex
 * off — matches legacy single-source behavior so the pill looks
 * unchanged for users who don't opt in to Codex.
 */
export function loadToggleState(): SourceToggleState {
  const claude = localStorage.getItem(STORAGE_KEY_CLAUDE);
  const codex = localStorage.getItem(STORAGE_KEY_CODEX);
  return {
    claude: claude === null ? true : claude === '1',
    codex: codex === '1',
  };
}

/** Persist the current toggle state. Call after any mutation. */
export function saveToggleState(state: SourceToggleState): void {
  localStorage.setItem(STORAGE_KEY_CLAUDE, state.claude ? '1' : '0');
  localStorage.setItem(STORAGE_KEY_CODEX, state.codex ? '1' : '0');
}

/**
 * Resolve the effective render mode given user toggles AND data
 * availability.
 *
 * If the user toggled both sources off we honor that explicitly with
 * 'none' (empty placeholder pill) rather than silently showing Claude.
 * If a source is toggled on but the data hasn't arrived yet we still
 * pick its mode so the layout doesn't flicker between empty and full
 * during initial load.
 */
export function resolveMode(
  state: SourceToggleState,
  hasClaudeData: boolean,
  hasCodexData: boolean,
): SourceMode {
  if (!state.claude && !state.codex) return 'none';

  const effClaude = state.claude && hasClaudeData;
  const effCodex = state.codex && hasCodexData;
  if (effClaude && effCodex) return 'both';
  if (effCodex) return 'codex';
  return 'claude';
}
