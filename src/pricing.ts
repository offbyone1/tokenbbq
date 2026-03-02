import type { TokenCounts } from './types.js';

const LITELLM_URL =
	'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

type ModelPricing = {
	input_cost_per_token?: number;
	output_cost_per_token?: number;
	cache_creation_input_token_cost?: number;
	cache_read_input_token_cost?: number;
};

const FALLBACK_PRICES: Record<string, ModelPricing> = {
	'claude-sonnet-4-20250514': {
		input_cost_per_token: 3e-6,
		output_cost_per_token: 15e-6,
		cache_read_input_token_cost: 0.3e-6,
		cache_creation_input_token_cost: 3.75e-6,
	},
	'claude-opus-4-20250514': {
		input_cost_per_token: 15e-6,
		output_cost_per_token: 75e-6,
		cache_read_input_token_cost: 1.5e-6,
		cache_creation_input_token_cost: 18.75e-6,
	},
	'gpt-5': {
		input_cost_per_token: 2e-6,
		output_cost_per_token: 8e-6,
		cache_read_input_token_cost: 0.5e-6,
	},
};

let pricingCache: Record<string, ModelPricing> | null = null;

async function fetchPricing(): Promise<Record<string, ModelPricing>> {
	if (pricingCache) return pricingCache;

	try {
		const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		pricingCache = (await res.json()) as Record<string, ModelPricing>;
		return pricingCache;
	} catch {
		pricingCache = FALLBACK_PRICES;
		return pricingCache;
	}
}

function findModelPricing(
	prices: Record<string, ModelPricing>,
	modelName: string,
): ModelPricing | null {
	if (prices[modelName]) return prices[modelName];

	const prefixes = ['anthropic/', 'openai/', 'openrouter/openai/', ''];
	for (const prefix of prefixes) {
		const key = prefix + modelName;
		if (prices[key]) return prices[key];
	}

	const cleaned = modelName.replace(/^\[pi\]\s*/, '');
	if (cleaned !== modelName) return findModelPricing(prices, cleaned);

	const baseMatch = modelName.replace(/-\d{8}$/, '');
	if (baseMatch !== modelName) return findModelPricing(prices, baseMatch);

	for (const key of Object.keys(prices)) {
		if (key.includes(modelName) || modelName.includes(key.replace(/^[^/]+\//, ''))) {
			return prices[key];
		}
	}

	return null;
}

export async function calculateCost(model: string, tokens: TokenCounts): Promise<number> {
	const prices = await fetchPricing();
	const pricing = findModelPricing(prices, model);
	if (!pricing) return 0;

	const inputCost = tokens.input * (pricing.input_cost_per_token ?? 0);
	const outputCost = tokens.output * (pricing.output_cost_per_token ?? 0);
	const cacheCreateCost =
		tokens.cacheCreation *
		(pricing.cache_creation_input_token_cost ?? pricing.input_cost_per_token ?? 0);
	const cacheReadCost =
		tokens.cacheRead *
		(pricing.cache_read_input_token_cost ?? pricing.input_cost_per_token ?? 0);

	return inputCost + outputCost + cacheCreateCost + cacheReadCost;
}

export async function enrichCosts(
	events: Array<{ model: string; tokens: TokenCounts; costUSD: number }>,
): Promise<void> {
	await fetchPricing();
	for (const event of events) {
		if (event.costUSD > 0) continue;
		event.costUSD = await calculateCost(event.model, event.tokens);
	}
}
