import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { totalTokenCount, addTokens, emptyTokens, type TokenCounts } from './types.js';

describe('totalTokenCount — ccusage parity', () => {
  test('sums input + output + cacheCreation + cacheRead', () => {
    const t: TokenCounts = {
      input: 1000, output: 500, cacheCreation: 2000, cacheRead: 300, reasoning: 0,
    };
    // Matches ccusage getTotalTokens (_token-utils.ts): 1000+500+2000+300.
    assert.equal(totalTokenCount(t), 3800);
  });

  test('EXCLUDES reasoning — it is informational only (already inside output for Codex)', () => {
    const withReasoning: TokenCounts = {
      input: 100, output: 50, cacheCreation: 0, cacheRead: 0, reasoning: 9999,
    };
    // ccusage never adds reasoning into its total; for Codex it lives inside
    // `output`. Adding it here would double-count. Total must ignore it.
    assert.equal(totalTokenCount(withReasoning), 150);
  });

  test('Claude-shaped tokens (reasoning always 0) are unaffected by the change', () => {
    const claude: TokenCounts = {
      input: 1234, output: 567, cacheCreation: 89, cacheRead: 4321, reasoning: 0,
    };
    assert.equal(totalTokenCount(claude), 1234 + 567 + 89 + 4321);
  });

  test('addTokens still tracks reasoning so it stays available for display', () => {
    const sum = addTokens(
      { input: 1, output: 2, cacheCreation: 3, cacheRead: 4, reasoning: 5 },
      { input: 1, output: 2, cacheCreation: 3, cacheRead: 4, reasoning: 5 },
    );
    assert.equal(sum.reasoning, 10);
    // ...but the total of the aggregate still excludes it.
    assert.equal(totalTokenCount(sum), 2 + 4 + 6 + 8);
  });

  test('emptyTokens carries the reasoning field', () => {
    assert.deepEqual(emptyTokens(), {
      input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0,
    });
  });
});
