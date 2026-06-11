import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { totalTokenCount, addTokens, emptyTokens, type TokenCounts } from './types.js';

describe('totalTokenCount — additive reasoning contract', () => {
	test('sums all five buckets including reasoning', () => {
		const t: TokenCounts = {
			input: 1000, output: 500, cacheCreation: 2000, cacheRead: 300, reasoning: 0,
		};
		assert.equal(totalTokenCount(t), 3800);
	});

	test('INCLUDES reasoning — loaders guarantee it is disjoint from output', () => {
		// Gemini (`thoughts`) and OpenCode report reasoning separately from
		// output, so it must count toward the total. Codex upholds the same
		// contract by carving reasoning OUT of output at the loader boundary
		// (OpenAI's output_tokens includes it upstream) — see loaders/codex.ts.
		// Excluding reasoning here would silently undercount Gemini/OpenCode.
		const withReasoning: TokenCounts = {
			input: 100, output: 50, cacheCreation: 0, cacheRead: 0, reasoning: 25,
		};
		assert.equal(totalTokenCount(withReasoning), 175);
	});

	test('Claude-shaped tokens (reasoning always 0) sum the four real buckets', () => {
		// Matches ccusage getTotalTokens for Claude: input+output+cache fields.
		const claude: TokenCounts = {
			input: 1234, output: 567, cacheCreation: 89, cacheRead: 4321, reasoning: 0,
		};
		assert.equal(totalTokenCount(claude), 1234 + 567 + 89 + 4321);
	});

	test('addTokens accumulates reasoning and the total reflects it', () => {
		const sum = addTokens(
			{ input: 1, output: 2, cacheCreation: 3, cacheRead: 4, reasoning: 5 },
			{ input: 1, output: 2, cacheCreation: 3, cacheRead: 4, reasoning: 5 },
		);
		assert.equal(sum.reasoning, 10);
		assert.equal(totalTokenCount(sum), 2 + 4 + 6 + 8 + 10);
	});

	test('emptyTokens carries the reasoning field', () => {
		assert.deepEqual(emptyTokens(), {
			input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0,
		});
	});
});
