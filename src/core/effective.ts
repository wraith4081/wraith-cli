import { type ConfigV1, ConfigV1Z, type Profile } from '@store/schema';

export type Approvals = 'auto' | 'prompt' | 'never';
export type RagMode = 'hot' | 'cold' | 'auto';
export type NetworkPolicy = 'on' | 'off' | 'prompt';

export interface EffectiveOverrides {
	/** Shorthand for model override (highest precedence) */
	model?: string;
	/** Temperature override, 0..2 */
	temperature?: number;
	approvals?: Approvals;
	ragMode?: RagMode;
	tools?: {
		networkPolicy?: NetworkPolicy;
		sandboxRoot?: string;
	};
}

export interface EffectiveInput {
	/** Merged config (loadConfig().merged) */
	config?: unknown;

	/** --profile flag */
	explicitProfile?: string;

	/** --model flag */
	explicitModel?: string;

	/** Per-command overrides (highest precedence) */
	overrides?: EffectiveOverrides;
}

export interface EffectiveResult {
	profile?: string;
	provider: 'openai';
	model: string;
	temperature?: number;
	approvals: Approvals;
	ragMode: RagMode;
	tools: {
		networkPolicy: NetworkPolicy;
		sandboxRoot: string;
	};
}

/**
 * Precedence: overrides > explicit flags > profile > config defaults.
 */
export function resolveEffectiveOptions(
	input: EffectiveInput = {}
): EffectiveResult {
	const parsed = ConfigV1Z.safeParse(input.config);
	const cfg: ConfigV1 = parsed.success ? parsed.data : { version: '1' };
	const defaults = cfg.defaults ?? {};
	const selectedProfileName =
		input.explicitProfile?.trim() || defaults.profile || undefined;
	const profile: Profile | undefined =
		selectedProfileName && cfg.profiles?.[selectedProfileName]
			? cfg.profiles[selectedProfileName]
			: undefined;

	const ov = input.overrides ?? {};

	// model
	const model =
		ov.model ??
		input.explicitModel ??
		profile?.model ??
		defaults.model ??
		'gpt-5';

	// temperature
	const temperature =
		ov.temperature ??
		(typeof profile?.temperature === 'number'
			? profile.temperature
			: undefined);

	// rag mode
	const ragMode: RagMode =
		ov.ragMode ??
		(profile?.rag?.mode as RagMode | undefined) ??
		(defaults.rag?.mode as RagMode | undefined) ??
		'auto';

	// approvals
	const approvals: Approvals =
		ov.approvals ??
		(defaults.approvals as Approvals | undefined) ??
		'prompt';

	// tools (network policy + sandbox root)
	const tools = {
		networkPolicy:
			ov.tools?.networkPolicy ??
			(profile?.tools?.networkPolicy as NetworkPolicy | undefined) ??
			(defaults.tools?.networkPolicy as NetworkPolicy | undefined) ??
			'prompt',
		sandboxRoot:
			ov.tools?.sandboxRoot ??
			profile?.tools?.sandboxRoot ??
			defaults.tools?.sandboxRoot ??
			'.',
	};

	return {
		profile: selectedProfileName,
		provider: 'openai',
		model,
		temperature,
		approvals,
		ragMode,
		tools,
	};
}

export const applyPerCommandOverrides = resolveEffectiveOptions;
