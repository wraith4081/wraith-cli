import fs from 'node:fs';
import path from 'node:path';
import { traceDir } from '@util/paths';
import type { TraceEvent } from './trace-types';

export interface TraceSinkOptions {
	/** rotate when file grows past this many bytes (default 5MB) */
	rotateAtBytes?: number;
	/** custom filename; default auto with timestamp */
	filePath?: string;
}

class TraceSink {
	private file: string;
	private rotateAt: number;
	private bytes = 0;
	private fd?: number;

	constructor(opts: TraceSinkOptions = {}) {
		const dir = traceDir();
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		this.file =
			opts.filePath ??
			path.join(
				dir,
				`trace.${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
			);
		this.rotateAt = Math.max(64 * 1024, opts.rotateAtBytes ?? 5_242_880);
		this.open();
		this.write({ t: 'cli.trace.enabled', ts: Date.now(), file: this.file });
	}

	private open() {
		this.fd = fs.openSync(this.file, 'a', 0o600);
		try {
			const st = fs.statSync(this.file);
			this.bytes = st.size;
		} catch {
			this.bytes = 0;
		}
	}

	private rotateIfNeeded(plus: number) {
		if (this.bytes + plus <= this.rotateAt) {
			return;
		}
		try {
			if (this.fd) {
				fs.closeSync(this.fd);
			}
		} catch {
			//
		}
		const rotated = this.file.replace(/\.jsonl$/, `.${Date.now()}.jsonl`);
		try {
			fs.renameSync(this.file, rotated);
		} catch {
			//
		}
		this.open();
	}

	write(ev: TraceEvent) {
		const line = `${JSON.stringify(ev)}\n`;
		this.rotateIfNeeded(Buffer.byteLength(line));
		if (!this.fd) {
			this.open();
		}
		fs.writeSync(this.fd as number, line);
		this.bytes += Buffer.byteLength(line);
	}
}

// --- simple module-level handle (mirrors logger pattern) ---
let active: TraceSink | undefined;
export function enableTrace(opts?: TraceSinkOptions) {
	active = new TraceSink(opts);
}
export function trace(): TraceSink | undefined {
	return active;
}
export function emit(ev: TraceEvent) {
	active?.write(ev);
}
