import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ClaudeUsageResponse } from '../src/types.js';
import { resolveMode } from '../src/source-toggle.js';
import {
  keepLastGoodOnClaudeFailure,
  keepLastGoodOnLocalFailure,
  formatOptionalUtilization,
  describeClaudeFailure,
  describeLocalFailure,
  usageForRender,
} from '../src/usage-state.js';

const usage: ClaudeUsageResponse = {
  five_hour: { utilization: 42, resets_at: null },
  seven_day: { utilization: 7, resets_at: null },
  extra_usage: null,
};

test('source toggle determines compact layout even while data is temporarily unavailable', () => {
  assert.equal(resolveMode({ claude: true, codex: true }, false, true), 'both');
  assert.equal(resolveMode({ claude: true, codex: true }, true, false), 'both');
  assert.equal(resolveMode({ claude: true, codex: false }, false, false), 'claude');
  assert.equal(resolveMode({ claude: false, codex: true }, false, false), 'codex');
  assert.equal(resolveMode({ claude: false, codex: false }, true, true), 'none');
});

test('claude polling failures keep the last good claude usage payload', () => {
  assert.equal(keepLastGoodOnClaudeFailure(usage), usage);
  assert.equal(keepLastGoodOnClaudeFailure(null), null);
});

test('source toggles can re-render before claude has a last successful payload', () => {
  assert.equal(usageForRender(usage), usage);
  assert.deepEqual(usageForRender(null), {
    five_hour: null,
    seven_day: null,
    extra_usage: null,
  });
});

test('local polling failures keep the last good local usage payload', () => {
  const local = {
    generated: '2026-05-17T12:00:00.000Z',
    todayDate: '2026-05-17',
    todayTokens: 1234,
    weekTokens: 5678,
    todayBySource: [{ source: 'claude-code', tokens: 1234 }],
    codexUsage: null,
  };

  assert.equal(keepLastGoodOnLocalFailure(local), local);
  assert.equal(keepLastGoodOnLocalFailure(null), null);
});

test('missing live utilization renders as neutral placeholder, not 0 percent or error text', () => {
  assert.equal(formatOptionalUtilization(undefined), '--');
  assert.equal(formatOptionalUtilization(null), '--');
  assert.equal(formatOptionalUtilization(0), '0%');
  assert.equal(formatOptionalUtilization(14.4), '14%');
});

test('claude failures stay out of user-facing chrome', () => {
  const missingAuth = describeClaudeFailure(
    'Could not read C:\\Users\\me\\.claude\\.credentials.json: not found. Run `claude auth login` to create it.',
    null,
  );
  assert.equal(missingAuth, null);

  const stale = describeClaudeFailure('Network error: timed out', usage);
  assert.equal(stale, null);
});

test('local failures become stale-status metadata while preserving the last local snapshot', () => {
  const local = {
    generated: '2026-05-17T12:00:00.000Z',
    todayDate: '2026-05-17',
    todayTokens: 1234,
    weekTokens: 5678,
    todayBySource: [{ source: 'codex', tokens: 1234 }],
    codexUsage: null,
  };

  const stale = describeLocalFailure('sidecar exited', local);
  assert.equal(stale.title, 'Showing last local values');
  assert.equal(stale.compactText, null);
  assert.match(stale.message, /sidecar exited/);

  const empty = describeLocalFailure('sidecar not found', null);
  assert.equal(empty.title, 'Local usage unavailable');
  assert.equal(empty.compactText, null);
});
