import { getLogger } from '@obs/logger';
import OpenAI from 'openai';
import {
	type ChatRequest,
	type ChatResult,
	type IProvider,
	type ModelInfo,
	ProviderError,
	type StreamDelta,
} from './types';

// Narrow helpers to avoid any
function hasProp<T extends string>(
	obj: unknown,
	prop: T
): obj is Record<T, unknown> {
	return typeof obj === 'object' && obj !== null && prop in obj;
}

function toStatus(err: unknown): number | undefined {
	if (
		hasProp(err, 'status') &&
		typeof (err as { status: unknown }).status === 'number'
	) {
		return (err as { status: number }).status;
	}
	if (hasProp(err, 'response')) {
		const resp = (err as { response?: unknown }).response;
		if (
			hasProp(resp, 'status') &&
			typeof (resp as { status: unknown }).status === 'number'
		) {
			return (resp as { status: number }).status;
		}
	}
	return;
}

function toMessage(err: unknown): string | undefined {
	if (
		hasProp(err, 'message') &&
		typeof (err as { message: unknown }).message === 'string'
	) {
		return (err as { message: string }).message;
	}
	if (hasProp(err, 'response')) {
		const resp = (err as { response?: unknown }).response;
		if (hasProp(resp, 'data')) {
			const data = (resp as { data?: unknown }).data;
			if (hasProp(data, 'error')) {
				const e = (data as { error?: unknown }).error;
				if (
					hasProp(e, 'message') &&
					typeof (e as { message?: unknown }).message === 'string'
				) {
					return (e as { message: string }).message;
				}
			}
		}
	}
	return;
}

function mapOpenAIError(err: unknown): ProviderError {
	const status = toStatus(err);
	const message = toMessage(err) ?? 'OpenAI error';
	const isAbort =
		(hasProp(err, 'name') &&
			typeof (err as { name?: unknown }).name === 'string' &&
			((err as { name: string }).name.toLowerCase().includes('abort') ||
				(err as { name: string }).name
					.toLowerCase()
					.includes('cancel'))) ||
		/aborted|aborterror|canceled?/i.test(message);

	if (status === 401 || /unauthorized|invalid api key/i.test(message)) {
		return new ProviderError('E_AUTH', message, { status, cause: err });
	}
	if (isAbort) {
		return new ProviderError('E_TIMEOUT', message, { status, cause: err });
	}
	return new ProviderError('E_PROVIDER', message, { status, cause: err });
}

export interface OpenAIProviderOptions {
	apiKey?: string;
	organization?: string;
	project?: string;
	defaultEmbeddingModel?: string;
}

function ensureApiKey(envKey?: string): string {
	const key =
		typeof envKey === 'string' ? envKey : process.env.OPENAI_API_KEY;
	if (!key?.trim()) {
		throw new ProviderError(
			'E_AUTH',
			'Missing OpenAI API key. Set OPENAI_API_KEY in your environment.'
		);
	}
	return key;
}

export class OpenAIProvider implements IProvider {
	readonly name = 'openai' as const;
	private client: OpenAI;
	private defaultEmbeddingModel: string;

	constructor(opts: OpenAIProviderOptions = {}) {
		const apiKey = ensureApiKey(opts.apiKey);
		this.client = new OpenAI({
			apiKey,
			organization: opts.organization,
			project: opts.project,
		});
		this.defaultEmbeddingModel =
			opts.defaultEmbeddingModel ?? 'text-embedding-3-large';
	}

	// Intentionally not querying provider for models. The CLI will use the Model Registry (catalog-based).
	async listModels(): Promise<ModelInfo[]> {
		return await Promise.resolve([]);
	}

	async streamChat(
		req: ChatRequest,
		onDelta: (delta: StreamDelta) => void,
		signal?: AbortSignal
	): Promise<ChatResult> {
		const log = getLogger();
		try {
			const messages = req.messages.map((m) => ({
				role: m.role,
				content: m.content,
			})) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

			const stream = await this.client.chat.completions.create(
				{
					model: req.model,
					messages,
					temperature: req.temperature,
					top_p: req.topP,
					stream: true,
				},
				{ signal }
			);

			let content = '';
			let finishReason: string | undefined;

			for await (const chunk of stream) {
				const choice = chunk.choices?.[0];
				const delta = choice?.delta;
				const token =
					typeof delta?.content === 'string' ? delta.content : '';
				if (token) {
					content += token;
					onDelta({ content: token });
				}
				if (typeof choice?.finish_reason === 'string') {
					finishReason = choice.finish_reason;
				}
			}

			return {
				model: req.model,
				content,
				finishReason,
			};
		} catch (err) {
			const mapped = mapOpenAIError(err);
			log.error({
				msg: 'openai-streamChat-error',
				code: mapped.code,
				status: mapped.status,
				error: mapped.message,
			});
			throw mapped;
		}
	}

	async embed(texts: string[], model?: string): Promise<number[][]> {
		try {
			const useModel = model ?? this.defaultEmbeddingModel;
			const res = await this.client.embeddings.create({
				model: useModel,
				input: texts,
			});
			return res.data.map((d) => d.embedding);
		} catch (err) {
			throw mapOpenAIError(err);
		}
	}
}
