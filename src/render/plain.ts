import type { AskResult } from '@core/orchestrator';

export interface PlainRenderOptions {
	showMeta?: boolean; // prints model/latency if true
}

export function printAskStreamingHeader(): void {
	// no-op for now; kept for future hooks
}

export function printDelta(s: string): void {
	process.stdout.write(s);
}

export function printAskFooter(
	res?: AskResult,
	opts: PlainRenderOptions = {}
): void {
	// Ensure trailing newline after streamed output
	process.stdout.write('\n');
	if (opts.showMeta && res) {
		const ms =
			typeof res.timing?.elapsedMs === 'number'
				? `${res.timing.elapsedMs}ms`
				: 'n/a';
		process.stderr.write(`[model: ${res.model}] [elapsed: ${ms}]\n`);
	}
}

export function printAskResultPlain(
	res: AskResult,
	opts: PlainRenderOptions = {}
): void {
	// Non-stream path: print full answer + optional meta
	process.stdout.write(res.answer ?? '');
	if (!res.answer?.endsWith('\n')) {
		process.stdout.write('\n');
	}
	if (opts.showMeta) {
		const ms =
			typeof res.timing?.elapsedMs === 'number'
				? `${res.timing.elapsedMs}ms`
				: 'n/a';
		process.stderr.write(`[model: ${res.model}] [elapsed: ${ms}]\n`);
	}
}
