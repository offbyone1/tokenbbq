/**
 * User preference for which sources the pill should display.
 *   "claude" — Claude Code Subscription only (default; current behavior)
 *   "codex"  — Codex only
 *   "both"   — stacked dual-mode (pill is taller)
 */
export type SourceMode = 'claude' | 'codex' | 'both';

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

export function saveToggleState(state: SourceToggleState): void {
  localStorage.setItem(STORAGE_KEY_CLAUDE, state.claude ? '1' : '0');
  localStorage.setItem(STORAGE_KEY_CODEX, state.codex ? '1' : '0');
}

/**
 * Resolve the effective render mode given user toggles AND data
 * availability. If the user toggled Codex on but the sidecar reports
 * codexUsage=null (no plan / no data), silently fall back to claude
 * so the pill never renders empty rows.
 */
export function resolveMode(
  state: SourceToggleState,
  hasClaudeData: boolean,
  hasCodexData: boolean,
): SourceMode {
  const effClaude = state.claude && hasClaudeData;
  const effCodex = state.codex && hasCodexData;
  if (effClaude && effCodex) return 'both';
  if (effCodex) return 'codex';
  return 'claude';  // default — matches legacy behavior even if !hasClaudeData
}
