import { resolveEffectiveOptions } from '@core/effective';
import { describe, expect, it } from 'vitest';

describe('resolveEffectiveOptions', () => {
	const cfg = {
		version: '1',
		defaults: {
			profile: 'dev',
			model: 'gpt-default',
			temperature: 0.7,
			approvals: 'prompt',
			rag: { mode: 'auto' },
			tools: { sandboxRoot: '.', networkPolicy: 'prompt' },
		},
		profiles: {
			dev: {
				model: 'gpt-dev',
				temperature: 0.2,
				rag: { mode: 'hot' },
				tools: { networkPolicy: 'on' },
			},
			qa: {
				model: 'gpt-qa',
				temperature: 1.0,
				rag: { mode: 'cold' },
				tools: { networkPolicy: 'off', sandboxRoot: '/tmp/qa' },
			},
		},
	};

	it('uses defaults + active profile from defaults.profile', () => {
		const eff = resolveEffectiveOptions({ config: cfg });
		expect(eff.profile).toBe('dev');
		expect(eff.provider).toBe('openai');
		expect(eff.model).toBe('gpt-dev'); // profile beats defaults.model
		expect(eff.temperature).toBe(0.2); // profile beats defaults.temperature
		expect(eff.ragMode).toBe('hot'); // profile rag
		expect(eff.approvals).toBe('prompt'); // from defaults
		expect(eff.tools.networkPolicy).toBe('on'); // profile beats defaults.tools
		expect(eff.tools.sandboxRoot).toBe('.'); // default carried through
	});

	it('explicit profile overrides defaults.profile', () => {
		const eff = resolveEffectiveOptions({
			config: cfg,
			explicitProfile: 'qa',
		});
		expect(eff.profile).toBe('qa');
		expect(eff.model).toBe('gpt-qa');
		expect(eff.temperature).toBe(1.0);
		expect(eff.ragMode).toBe('cold');
		expect(eff.tools.networkPolicy).toBe('off');
		expect(eff.tools.sandboxRoot).toBe('/tmp/qa');
	});

	it('explicit model overrides profile/defaults', () => {
		const eff = resolveEffectiveOptions({
			config: cfg,
			explicitProfile: 'dev',
			explicitModel: 'gpt-flag',
		});
		expect(eff.model).toBe('gpt-flag');
	});

	it('per-command overrides have highest precedence', () => {
		const eff = resolveEffectiveOptions({
			config: cfg,
			explicitProfile: 'qa',
			explicitModel: 'gpt-flag',
			overrides: {
				model: 'gpt-override',
				temperature: 1.5,
				approvals: 'auto',
				ragMode: 'hot',
				tools: { networkPolicy: 'prompt', sandboxRoot: '/override' },
			},
		});
		expect(eff.model).toBe('gpt-override'); // overrides>flag>profile
		expect(eff.temperature).toBe(1.5);
		expect(eff.approvals).toBe('auto');
		expect(eff.ragMode).toBe('hot');
		expect(eff.tools.networkPolicy).toBe('prompt');
		expect(eff.tools.sandboxRoot).toBe('/override');
	});

	it('falls back sanely when no defaults/profile are present', () => {
		const minimal = resolveEffectiveOptions({ config: { version: '1' } });
		expect(minimal.profile).toBeUndefined();
		expect(minimal.model).toBe('gpt-5'); // hard fallback
		expect(minimal.ragMode).toBe('auto');
		expect(minimal.approvals).toBe('prompt');
		expect(minimal.tools.networkPolicy).toBe('prompt');
		expect(minimal.tools.sandboxRoot).toBe('.');
	});
});
