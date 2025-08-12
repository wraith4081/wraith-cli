export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
	role: Role;
	content: string;
}

export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	topP?: number;
	// Reserved for future structured output / tools without forcing dependencies here
	jsonSchema?: unknown;
	tools?: unknown;
}

export interface ChatUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

export interface ChatResult {
	model: string;
	content: string;
	finishReason?: string;
	usage?: ChatUsage;
}

export interface ModelInfo {
	id: string;
	contextLength?: number | null;
	modalities?: string[]; // e.g., ["text"]
}

export interface StreamDelta {
	content?: string; // streamed text delta
}

export interface IProvider {
	readonly name: 'openai';
	listModels(): Promise<ModelInfo[]>;
	streamChat(
		req: ChatRequest,
		onDelta: (delta: StreamDelta) => void,
		signal?: AbortSignal
	): Promise<ChatResult>;
	embed(texts: string[], model?: string): Promise<number[][]>;
}

export type ProviderErrorCode = 'E_AUTH' | 'E_PROVIDER' | 'E_TIMEOUT';

export class ProviderError extends Error {
	code: ProviderErrorCode;
	status?: number;
	constructor(
		code: ProviderErrorCode,
		message: string,
		opts?: { status?: number; cause?: unknown }
	) {
		super(message);
		this.name = 'ProviderError';
		this.code = code;
		this.status = opts?.status;
		if (opts?.cause) {
			this.cause = opts.cause;
		}
	}
}

export function isProviderError(e: unknown): e is ProviderError {
	return e instanceof Error && e.name === 'ProviderError';
}
