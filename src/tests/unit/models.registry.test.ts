import { getModelCatalog, resolveModelId } from '@models/registry';
import type { ConfigV1 } from '@store/schema';
import { describe, expect, it } from 'vitest';

describe('Model Registry', () => {
	it('returns builtin gpt-5 when no config provided', () => {
		const catalog = getModelCatalog();
		const gpt5 = catalog.find((m) => m.key === 'gpt-5');
		expect(gpt5).toBeDefined();
		expect(gpt5?.id).toBe('gpt-5');
		expect(gpt5?.modalities).toContain('text');
	});

	it('merges config-defined models and resolves aliases', () => {
		const cfg: ConfigV1 = {
			version: '1',
			models: {
				catalog: {
					'my-fast-model': {
						id: 'gpt-4o-mini',
						label: 'Fast budget model',
						contextLength: 128_000,
						modalities: ['text'],
					},
				},
				aliases: {
					fast: 'my-fast-model',
					default: 'gpt-5',
				},
			},
		};

		const catalog = getModelCatalog(cfg);
		const fastKey = catalog.find((m) => m.key === 'my-fast-model');
		expect(fastKey).toBeDefined();
		expect(fastKey?.id).toBe('gpt-4o-mini');
		expect(fastKey?.aliases).toContain('fast');

		const resolved1 = resolveModelId('fast', cfg);
		expect(resolved1?.id).toBe('gpt-4o-mini');

		const resolved2 = resolveModelId('gpt-5', cfg);
		expect(resolved2?.id).toBe('gpt-5');
	});
});
