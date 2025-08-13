import type { ChatMessage } from '@provider/types';

export interface FitContextOptions {
	modelId?: string;
	/**
	 * Target maximum input tokens for the request (messages only).
	 * If omitted, a conservative default is used (8192 - 1024 reserve).
	 */
	maxInputTokens?: number;
	/**
	 * Reserve tokens for the model's response (not used in counting messages).
	 * Only used when maxInputTokens is not provided.
	 * Default: 1024.
	 */
	reserveForResponse?: number;
}

/**
 * Simple, deterministic token estimator: ~4 bytes per token.
 * Works well enough for budgeting/pruning without provider-specific tokenizers.
 */
function estimateTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

function totalTokensOf(messages: ChatMessage[]): number {
	let t = 0;
	for (const m of messages) {
		// Include role tag overhead lightly to bias toward safety.
		t += 4; // role/speaker + separators
		t += estimateTokens(m.content ?? '');
	}
	return t;
}

function defaultMaxInputTokens(_modelId?: string, reserve = 1024): number {
	// Pick a conservative default: assume ~8k context; reserve 1k for completion.
	// (Later we can pull actual model metadata; tests can override via maxInputTokens.)
	const assumed = 8192;
	return Math.max(1024, assumed - Math.max(256, reserve));
}

export interface FitContextResult {
	messages: ChatMessage[];
	notices: string[];
	prunedCount: number;
	totalTokens: number;
}

/**
 * Ensure message list stays within a token budget by pruning oldest user/assistant turns.
 * - Always preserves the first message when it's the system prompt.
 * - Adds a visible notice (returned) when pruning happens.
 */
export function fitMessagesToContext(
	input: ChatMessage[],
	opts: FitContextOptions = {}
): FitContextResult {
	// Clone shallowly so callers' arrays remain untouched.
	const messages = input.slice();

	const budget =
		typeof opts.maxInputTokens === 'number' && opts.maxInputTokens > 0
			? Math.floor(opts.maxInputTokens)
			: defaultMaxInputTokens(opts.modelId, opts.reserveForResponse);

	const current = totalTokensOf(messages);
	if (current <= budget) {
		return { messages, notices: [], prunedCount: 0, totalTokens: current };
	}

	// Identify if there's a system prompt at the head; we will try to keep it.
	const hasSystemHead = messages.length > 0 && messages[0]?.role === 'system';

	// Build a keep list from the tail (newest first) until under budget; then reverse.
	const kept: ChatMessage[] = [];
	let keptTokens = 0;

	// Always consider the last N messages first (most recent messages are more salient).
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const tokens = totalTokensOf([msg]);
		// If adding this would exceed budget and we already kept something, stop.
		if (kept.length > 0 && keptTokens + tokens > budget) {
			break;
		}
		kept.push(msg);
		keptTokens += tokens;
	}

	kept.reverse();

	// If we had a system prompt up front and it got dropped, try to re-add it (preferred).
	if (hasSystemHead) {
		const system = messages[0];
		const sysTokens = totalTokensOf([system]);
		const canPrepend = sysTokens + keptTokens <= budget;
		if (canPrepend) {
			kept.unshift(system);
			keptTokens += sysTokens;
		}
	}

	const prunedCount = messages.length - kept.length;
	const notices: string[] = [];

	if (prunedCount > 0) {
		notices.push(
			`(context trimmed) Omitted ${prunedCount} earlier message${
				prunedCount === 1 ? '' : 's'
			} to fit the model context window.`
		);
	}

	return {
		messages: kept,
		notices,
		prunedCount,
		totalTokens: keptTokens,
	};
}
