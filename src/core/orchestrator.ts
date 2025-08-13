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
	const selection = resolveEffectiveModel({
		config: mergedConfig,
		explicitModel: opts.modelFlag,
		explicitProfile: opts.profileFlag,
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
		overrideContent: opts.systemOverride, // persists across the whole session
	});

	// Seed history
	const history: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

	if (opts.instructions?.trim()) {
		// If caller provided persistent instructions, inject as the first user turn
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
			let aborted = false;

			// We send a *bounded* copy; the real session history remains intact.
			const bounded = fitMessagesToContext(history, {
				modelId: selection.modelId,
				// Defaults are safe; later we can make this configurable per model/profile.
			}).messages;
			const notices = fitMessagesToContext(history, {
				modelId: selection.modelId,
			}).notices;

			try {
				const res = await provider.streamChat(
					{
						model: selection.modelId,
						messages: bounded,
					},
					(d) => {
						if (
							typeof d.content === 'string' &&
							d.content.length > 0
						) {
							acc += d.content;
							if (onDelta) {
								onDelta(d.content);
							}
						}
					},
					signal
				);

				const elapsedMs = Date.now() - startedAt;
				const content = acc.length > 0 ? acc : (res.content ?? '');

				// Persist assistant message that the user actually saw
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
				aborted = true;

				const content = acc;
				if (content.length > 0) {
					history.push({ role: 'assistant', content });
				}

				return {
					content,
					model: selection.modelId,
					usage: undefined,
					aborted,
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
		overrideTitle: 'Command Overrides',
		overrideContent: opts.systemOverride, // append if provided
	});

	const messages: { role: 'system' | 'user'; content: string }[] = [
		{ role: 'system', content: systemPrompt },
	];

	if (opts.instructions?.trim()) {
		// If caller passed instructions, keep them as a dedicated first user turn
		messages.push({
			role: 'user',
			content:
				'Follow these persistent instructions for this request:\n' +
				opts.instructions.trim(),
		});
	}

	messages.push({ role: 'user', content: opts.prompt });

	let accumulated = '';
	const onDelta = (s: string) => {
		accumulated += s;
		if (deps.onDelta) {
			deps.onDelta(s);
		}
	};
	// pass messages to provider.streamChat(...)
	const result = await provider.streamChat(
		{ model: selection.modelId, messages },
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
