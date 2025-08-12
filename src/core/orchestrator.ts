import { resolveEffectiveModel } from '@models/selection';
import { OpenAIProvider } from '@provider/openai';
import type { ChatUsage, IProvider } from '@provider/types';
import { loadConfig } from '@store/config';

const DEFAULT_SYSTEM_PROMPT =
	'You are a helpful developer CLI assistant. Provide concise, accurate answers suitable for terminal output.';

export interface AskOptions {
	prompt: string;
	modelFlag?: string;
	profileFlag?: string;
}

export interface AskDeps {
	provider?: IProvider; // if omitted, uses OpenAIProvider()
	config?: unknown; // if omitted, uses loadConfig().merged
	onDelta?: (chunk: string) => void; // called on streamed tokens
	signal?: AbortSignal; // cancellation support
}

export interface AskResult {
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
				{ role: 'system', content: DEFAULT_SYSTEM_PROMPT },
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
