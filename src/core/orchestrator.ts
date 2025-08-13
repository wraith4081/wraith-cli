import { resolveEffectiveModel } from '@models/selection';
import { OpenAIProvider } from '@provider/openai';
import type { ChatUsage, IProvider } from '@provider/types';
import { loadUserAndProjectRules } from '@rules/loader';
import {
	buildEffectiveSystemPrompt,
	getDefaultSystemPrompt,
} from '@rules/manager';
import { loadConfig } from '@store/config';

export interface AskOptions {
	prompt: string;
	modelFlag?: string;
	profileFlag?: string;
}

export interface AskDeps {
	provider?: IProvider;
	config?: unknown;
	onDelta?: (chunk: string) => void;
	signal?: AbortSignal;
}

export interface AskResult {
	answer: string;
	model: string;
	usage?: ChatUsage;
	timing: { startedAt: number; elapsedMs: number };
}

export interface AskOkJson {
	ok: true;
	answer: string;
	model: string;
	usage?: ChatUsage;
	timing: { startedAt: number; elapsedMs: number };
}

export async function runAsk(
	opts: AskOptions,
	deps: AskDeps = {}
): Promise<AskResult> {
	const startedAt = Date.now();

	const mergedConfig = deps.config ?? loadConfig().merged;
	const selection = resolveEffectiveModel({
		config: mergedConfig,
		explicitModel: opts.modelFlag,
		explicitProfile: opts.profileFlag,
	});

	const provider: IProvider = deps.provider ?? new OpenAIProvider();

	// Load rules from user/project files and build the effective system prompt
	const { userSections, projectSections } = loadUserAndProjectRules({
		config: mergedConfig,
		profileName: selection.profile,
		overLimitBehavior: 'summarize',
		maxChars: 16_000,
	});

	const systemPrompt = buildEffectiveSystemPrompt({
		defaultPrompt: getDefaultSystemPrompt(),
		userSections,
		projectSections,
		// per-command override will be added in a later task
	});

	let accumulated = '';
	const onDelta = (s: string) => {
		accumulated += s;
		if (deps.onDelta) {
			deps.onDelta(s);
		}
	};

	const result = await provider.streamChat(
		{
			model: selection.modelId,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: opts.prompt },
			],
		},
		(d) => {
			if (typeof d.content === 'string' && d.content.length > 0) {
				onDelta(d.content);
			}
		},
		deps.signal
	);

	const elapsedMs = Date.now() - startedAt;
	return {
		answer: accumulated.length > 0 ? accumulated : result.content,
		model: selection.modelId,
		usage: result.usage,
		timing: { startedAt, elapsedMs },
	};
}
