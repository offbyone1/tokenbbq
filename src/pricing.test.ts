import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// Bypass the LiteLLM fetch — pin findModelPricing/calculateCost behavior
// against a synthetic price map so the C11 fallback (cache cost → 0
// when no explicit cache rate, NOT → input rate) is locked in.
mock.method(globalThis, 'fetch', async () =>
  new Response(
    JSON.stringify({
      'with-cache-pricing': {
        input_cost_per_token: 1e-6,
        output_cost_per_token: 4e-6,
        cache_creation_input_token_cost: 1.25e-6,
        cache_read_input_token_cost: 0.1e-6,
      },
      'without-cache-pricing': {
        input_cost_per_token: 1e-6,
        output_cost_per_token: 4e-6,
      },
      // Provider-prefixed entries — exercise the prefix-lookup loop in
      // findModelPricing, including the `gemini/` prefix added in C12.
      'gemini/gemini-2.5-flash': {
        input_cost_per_token: 0.3e-6,
        output_cost_per_token: 2.5e-6,
      },
      // Two models that *fuzzy*-collided pre-C12: `gpt-4` would have
      // returned whichever of these came first in JSON-iteration order
      // via the now-removed `key.includes(modelName)` check.
      'gpt-4o': {
        input_cost_per_token: 5e-6,
        output_cost_per_token: 15e-6,
      },
      'gpt-4-turbo': {
        input_cost_per_token: 10e-6,
        output_cost_per_token: 30e-6,
      },
      // Claude-shaped tiered model: tokens above 200k (per type, per event)
      // are billed at the *_above_200k_tokens rate. Mirrors ccusage's
      // calculateTieredCost (packages/internal/src/pricing.ts:284).
      'tiered-model': {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 15e-6,
        cache_creation_input_token_cost: 3.75e-6,
        cache_read_input_token_cost: 0.3e-6,
        input_cost_per_token_above_200k_tokens: 6e-6,
        output_cost_per_token_above_200k_tokens: 22.5e-6,
        cache_creation_input_token_cost_above_200k_tokens: 7.5e-6,
        cache_read_input_token_cost_above_200k_tokens: 0.6e-6,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ),
);

const { calculateCost } = await import('./pricing.js');

const counts = (over: Partial<Record<string, number>> = {}) => ({
  input: 1000,
  output: 500,
  cacheCreation: 200,
  cacheRead: 800,
  reasoning: 0,
  ...over,
});

describe('calculateCost — cache pricing fallback (C11)', () => {
  test('uses explicit cache rates when LiteLLM provides them', async () => {
    const cost = await calculateCost('with-cache-pricing', counts());
    // 1000*1e-6 + 500*4e-6 + 200*1.25e-6 + 800*0.1e-6
    //   = 1e-3 + 2e-3 + 0.25e-3 + 0.08e-3 = 0.00333
    assert.equal(cost.toFixed(6), '0.003330');
  });

  test('falls back to 0 (NOT input rate) when no cache pricing is published', async () => {
    const cost = await calculateCost('without-cache-pricing', counts());
    // Cache portions must contribute 0. Pre-fix: 200*1e-6 + 800*1e-6 = 1e-3
    // would have been added — a 30%+ overcharge on this synthetic case.
    // Post-fix: 1000*1e-6 + 500*4e-6 = 0.003 only.
    assert.equal(cost.toFixed(6), '0.003000');
  });

  test('returns 0 for unknown models', async () => {
    const cost = await calculateCost('does-not-exist', counts());
    assert.equal(cost, 0);
  });
});

describe('calculateCost — tiered >200k pricing (ccusage parity)', () => {
  test('flat pricing below the 200k threshold', async () => {
    const cost = await calculateCost('tiered-model', counts({
      input: 100_000, output: 0, cacheCreation: 0, cacheRead: 0,
    }));
    // 100k * 3e-6 = 0.30 — no tier applied below threshold.
    assert.equal(cost.toFixed(6), (0.3).toFixed(6));
  });

  test('input above 200k splits at the threshold (ccusage example)', async () => {
    const cost = await calculateCost('tiered-model', counts({
      input: 300_000, output: 0, cacheCreation: 0, cacheRead: 0,
    }));
    // ccusage docs example: 200k*3e-6 + 100k*6e-6 = 0.6 + 0.6 = 1.2
    assert.equal(cost.toFixed(6), (1.2).toFixed(6));
  });

  test('each token type is tiered independently, per event', async () => {
    const cost = await calculateCost('tiered-model', counts({
      input: 0, output: 0, cacheCreation: 0, cacheRead: 250_000,
    }));
    // cacheRead: 200k*0.3e-6 + 50k*0.6e-6 = 0.06 + 0.03 = 0.09
    assert.equal(cost.toFixed(6), (0.09).toFixed(6));
  });

  test('models WITHOUT above_200k fields stay flat even past 200k (== ccusage)', async () => {
    const cost = await calculateCost('gpt-4o', counts({
      input: 500_000, output: 0, cacheCreation: 0, cacheRead: 0,
    }));
    // No tiered field → flat: 500k * 5e-6 = 2.5 (ccusage falls back to base too).
    assert.equal(cost.toFixed(6), (2.5).toFixed(6));
  });
});

describe('calculateCost — reasoning billed at the output rate', () => {
  test('reasoning tokens are priced like output tokens', async () => {
    // Providers bill reasoning as output: OpenAI's output_tokens includes it
    // upstream (the Codex loader splits it into `reasoning`), Gemini bills
    // `thoughts` at the output rate. output 300 + reasoning 200 must cost the
    // same as output 500 alone.
    const split = await calculateCost('with-cache-pricing', counts({
      input: 0, output: 300, cacheCreation: 0, cacheRead: 0, reasoning: 200,
    }));
    const merged = await calculateCost('with-cache-pricing', counts({
      input: 0, output: 500, cacheCreation: 0, cacheRead: 0, reasoning: 0,
    }));
    assert.equal(split.toFixed(6), merged.toFixed(6));
    // 500 * 4e-6 = 0.002
    assert.equal(split.toFixed(6), '0.002000');
  });

  test('output + reasoning share one 200k tier bucket', async () => {
    // Reasoning IS output upstream, so the >200k output tier applies to the
    // combined volume: 150k+100k = 250k → 200k*15e-6 + 50k*22.5e-6 = 4.125.
    const cost = await calculateCost('tiered-model', counts({
      input: 0, output: 150_000, cacheCreation: 0, cacheRead: 0, reasoning: 100_000,
    }));
    assert.equal(cost.toFixed(6), (4.125).toFixed(6));
  });
});

describe('findModelPricing — prefix lookups (C12)', () => {
  test('finds Gemini models via the gemini/ prefix', async () => {
    // Loader emits the bare model name; LiteLLM keys it with the prefix.
    const cost = await calculateCost('gemini-2.5-flash', counts({
      input: 1000, output: 0, cacheCreation: 0, cacheRead: 0,
    }));
    // 1000 * 0.3e-6 = 3e-4
    assert.equal(cost.toFixed(7), '0.0003000');
  });

  test('does not fuzzy-match partial model names', async () => {
    // Pre-C12: `gpt-4` would have matched whichever of `gpt-4o` /
    // `gpt-4-turbo` came first via Object.keys iteration order. We now
    // require an exact or prefix match — unmatched names get 0.
    const cost = await calculateCost('gpt-4', counts());
    assert.equal(cost, 0);
  });

  test('strips the [pi] prefix loaders prepend before lookup', async () => {
    // Pi-Agent loader emits model as `[pi] gpt-4o` (see src/loaders/pi.ts);
    // findModelPricing should still find `gpt-4o` after the prefix strip.
    const cost = await calculateCost('[pi] gpt-4o', counts({
      input: 1000, output: 0, cacheCreation: 0, cacheRead: 0,
    }));
    assert.equal(cost.toFixed(7), '0.0050000');
  });
});
