import { resolveEffectiveOptions } from '@core/effective';
import { resolveEffectiveModel } from '@models/selection';
import { OpenAIProvider } from '@provider/openai';
import type { ChatMessage, ChatUsage, IProvider } from '@provider/types';
import { loadUserAndProjectRules } from '@rules/loader';
import {
	buildEffectiveSystemPrompt,
	getDefaultSystemPrompt,
} from '@rules/manager';
import { loadConfig } from '@store/config';
import { fitMessagesToContext } from './context-window';

export interface AskOptions {
	prompt: string;
	modelFlag?: string;
	profileFlag?: string;
	systemOverride?: string;
	instructions?: string;
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

export interface ChatTurnResult {
	content: string;
	model: string;
	usage?: ChatUsage;
	aborted?: boolean;
	notices?: string[];
	timing: { startedAt: number; elapsedMs: number };
}

export interface ChatSession {
	model: string;
	profile?: string;
	history: ChatMessage[]; // includes system as [0]
	addUser(content: string): void;
	runAssistant(
		onDelta?: (s: string) => void,
		signal?: AbortSignal
	): Promise<ChatTurnResult>;
}

export interface StartChatOptions {
	modelFlag?: string;
	profileFlag?: string;
	systemOverride?: string;
	instructions?: string;
}

export interface StartChatDeps {
	provider?: IProvider;
	config?: unknown;
}

export function startChatSession(
	opts: StartChatOptions = {},
	deps: StartChatDeps = {}
): ChatSession {
	const mergedConfig = deps.config ?? loadConfig().merged;

	const eff = resolveEffectiveOptions({
		config: mergedConfig,
		explicitModel: opts.modelFlag,
		explicitProfile: opts.profileFlag,
	});

	const selection = resolveEffectiveModel({
		config: mergedConfig,
		explicitModel: eff.model,
		explicitProfile: eff.profile,
	});

	const provider: IProvider = deps.provider ?? new OpenAIProvider();

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
		overrideTitle: 'Session Overrides',
		overrideContent: opts.systemOverride,
	});

	// Seed history
	const history: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

	if (opts.instructions?.trim()) {
		history.push({
			role: 'user',
			content:
				'Follow these persistent instructions for this session:\n' +
				opts.instructions.trim(),
		});
	}

	const session: ChatSession = {
		model: selection.modelId,
		profile: selection.profile,
		history,

		addUser(content: string) {
			if (content.trim().length === 0) {
				return;
			}
			history.push({ role: 'user', content });
		},

		async runAssistant(
			onDelta?: (s: string) => void,
			signal?: AbortSignal
		): Promise<ChatTurnResult> {
			const startedAt = Date.now();
			let acc = '';

			const boundedRes = fitMessagesToContext(history, {
				modelId: selection.modelId,
			});
			const bounded = boundedRes.messages;
			const notices = boundedRes.notices;

			try {
				const res = await provider.streamChat(
					{ model: selection.modelId, messages: bounded },
					(d) => {
						if (
							typeof d.content === 'string' &&
							d.content.length > 0
						) {
							acc += d.content;
							onDelta?.(d.content);
						}
					},
					signal
				);

				const elapsedMs = Date.now() - startedAt;
				const content = acc.length > 0 ? acc : (res.content ?? '');

				history.push({ role: 'assistant', content });

				return {
					content,
					model: selection.modelId,
					usage: res.usage,
					aborted: false,
					notices,
					timing: { startedAt, elapsedMs },
				};
			} catch {
				const elapsedMs = Date.now() - startedAt;
				const content = acc;
				if (content.length > 0) {
					history.push({ role: 'assistant', content });
				}
				return {
					content,
					model: selection.modelId,
					usage: undefined,
					aborted: true,
					notices,
					timing: { startedAt, elapsedMs },
				};
			}
		},
	};

	return session;
}

export async function runAsk(
	opts: AskOptions,
	deps: AskDeps = {}
): Promise<AskResult> {
	const startedAt = Date.now();

	const mergedConfig = deps.config ?? loadConfig().merged;

	const eff = resolveEffectiveOptions({
		config: mergedConfig,
		explicitModel: opts.modelFlag,
		explicitProfile: opts.profileFlag,
	});

	const selection = resolveEffectiveModel({
		config: mergedConfig,
		explicitModel: eff.model,
		explicitProfile: eff.profile,
	});

	const provider: IProvider = deps.provider ?? new OpenAIProvider();

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
		overrideTitle: 'Command Overrides',
		overrideContent: opts.systemOverride,
	});

	const messages: { role: 'system' | 'user'; content: string }[] = [
		{ role: 'system', content: systemPrompt },
	];

	if (opts.instructions?.trim()) {
		messages.push({
			role: 'user',
			content:
				'Follow these persistent instructions for this request:\n' +
				opts.instructions.trim(),
		});
	}

	messages.push({ role: 'user', content: opts.prompt });

	let accumulated = '';
	const result = await provider.streamChat(
		{ model: selection.modelId, messages },
		(d) => {
			if (typeof d.content === 'string' && d.content.length > 0) {
				accumulated += d.content;
				deps.onDelta?.(d.content);
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
