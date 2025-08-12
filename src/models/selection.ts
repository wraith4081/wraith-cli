import { resolveModelId } from '@models/registry';
import { type ConfigV1, ConfigV1Z } from '@store/schema';

export type SelectionSource = 'flag' | 'profile' | 'defaults' | 'fallback';

export interface ModelSelectionInput {
	config: unknown;
	explicitModel?: string; // from CLI --model
	explicitProfile?: string; // from CLI --profile
}

export interface ModelSelection {
	provider: 'openai';
	modelId: string; // provider-ready model id
	catalogKey?: string; // if resolved from catalog
	aliasResolvedFrom?: string; // if user-provided alias/key differed from provider id
	source: SelectionSource;
	profile?: string;
}

function parseConfig(config: unknown): ConfigV1 | undefined {
	const parsed = ConfigV1Z.safeParse(config);
	return parsed.success ? parsed.data : undefined;
}

export function resolveActiveProfile(
	config: unknown,
	explicit?: string
): string | undefined {
	if (explicit && explicit.trim().length > 0) {
		return explicit.trim();
	}
	const cfg = parseConfig(config);
	if (!cfg) {
		return;
	}
	if (cfg.defaults?.profile) {
		return cfg.defaults.profile;
	}
	const keys = cfg.profiles ? Object.keys(cfg.profiles) : [];
	if (keys.length === 1) {
		return keys[0];
	}
	return;
}

function getCandidateModel(
	cfg: ConfigV1 | undefined,
	profileName?: string
): { candidate: string; source: SelectionSource } {
	// Try profile-scoped model
	if (
		cfg &&
		profileName &&
		cfg.profiles &&
		cfg.profiles[profileName]?.model
	) {
		return {
			candidate: cfg.profiles[profileName].model,
			source: 'profile',
		};
	}
	if (cfg?.defaults?.model) {
		return { candidate: cfg.defaults.model, source: 'defaults' };
	}

	return { candidate: 'gpt-5', source: 'fallback' };
}

export function resolveEffectiveModel(
	input: ModelSelectionInput
): ModelSelection {
	const cfg = parseConfig(input.config);
	const profile = resolveActiveProfile(cfg, input.explicitProfile);

	let source: SelectionSource = 'fallback';
	let candidate = input.explicitModel?.trim();
	if (candidate && candidate.length > 0) {
		source = 'flag';
	} else {
		const picked = getCandidateModel(cfg, profile);
		candidate = picked.candidate;
		source = picked.source;
	}

	const resolved = resolveModelId(candidate, cfg);
	if (resolved) {
		const aliasResolvedFrom =
			candidate !== resolved.id && candidate !== resolved.key
				? candidate
				: undefined;
		return {
			provider: 'openai',
			modelId: resolved.id,
			catalogKey: resolved.key,
			aliasResolvedFrom,
			source,
			profile,
		};
	}

	return {
		provider: 'openai',
		modelId: candidate,
		source,
		profile,
	};
}
