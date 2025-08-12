import { resolveActiveProfile, resolveEffectiveModel } from '@models/selection';
import type { ConfigV1 } from '@store/schema';
import { describe, expect, it } from 'vitest';

describe('Model selection', () => {
	const baseCfg: ConfigV1 = {
		version: '1',
		defaults: {
			profile: 'dev',
			model: 'gpt-5',
		},
		profiles: {
			dev: {
				model: 'my-fast-model',
			},
		},
		models: {
			catalog: {
				'my-fast-model': {
					id: 'gpt-4o-mini',
					label: 'Fast',
					contextLength: 128_000,
					modalities: ['text'],
				},
			},
			aliases: {
				fast: 'my-fast-model',
			},
		},
	};

	it('resolves active profile: explicit > defaults > single profile', () => {
		expect(resolveActiveProfile(baseCfg, 'work')).toBe('work');
		expect(resolveActiveProfile(baseCfg)).toBe('dev');
		const singleProfileCfg: ConfigV1 = {
			version: '1',
			profiles: { solo: {} },
		};
		expect(resolveActiveProfile(singleProfileCfg)).toBe('solo');
	});

	it('uses explicit --model when provided', () => {
		const sel = resolveEffectiveModel({
			config: baseCfg,
			explicitModel: 'fast',
		});
		expect(sel.modelId).toBe('gpt-4o-mini');
		expect(sel.source).toBe('flag');
		expect(sel.aliasResolvedFrom).toBe('fast');
		expect(sel.provider).toBe('openai');
	});

	it('falls back to profile model, then defaults, then gpt-5', () => {
		const sel1 = resolveEffectiveModel({ config: baseCfg });
		expect(sel1.modelId).toBe('gpt-4o-mini');
		expect(sel1.source).toBe('profile');

		const noProfileCfg: ConfigV1 = {
			version: '1',
			defaults: { model: 'gpt-5' },
		};
		const sel2 = resolveEffectiveModel({ config: noProfileCfg });
		expect(sel2.modelId).toBe('gpt-5');
		expect(sel2.source).toBe('defaults');

		const emptyCfg: ConfigV1 = { version: '1' };
		const sel3 = resolveEffectiveModel({ config: emptyCfg });
		expect(sel3.modelId).toBe('gpt-5');
		expect(sel3.source).toBe('fallback');
	});

	it('treats unknown candidate as provider id for OpenAI', () => {
		const sel = resolveEffectiveModel({
			config: baseCfg,
			explicitModel: 'gpt-5-experimental',
		});
		expect(sel.modelId).toBe('gpt-5-experimental');
		expect(sel.provider).toBe('openai');
		expect(sel.catalogKey).toBeUndefined();
	});
});
