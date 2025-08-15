import { type ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { childLogger } from '@obs/logger';
import { ToolExecutionError, ToolPermissionError } from '@tools/errors';
import type { ToolRegistry } from '@tools/registry';
import type { ToolHandler, ToolSpec } from '@tools/types';

const log = childLogger({ mod: 'tools.shell' });

type Json = Record<string, unknown>;

function ensureInside(base: string, dir: string): string {
	const abs = path.resolve(base, dir);
	const rel = path.relative(base, abs);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		log.warn({
			msg: 'shell.cwd-escape',
			base,
			dir,
			resolved: abs,
		});
		throw new ToolPermissionError(
			'shell.exec',
			`cwd escapes sandbox: ${dir}`
		);
	}
	return abs;
}

function sha8(s: string): string {
	return crypto
		.createHash('sha256')
		.update(s, 'utf8')
		.digest('hex')
		.slice(0, 8);
}

/** Tokenize a shell-ish string minimally for heuristics (whitespace split, drop empties). */
function looseTokens(s: string): string[] {
	return s
		.trim()
		.split(/\s+/g)
		.filter((t) => t.length > 0);
}

/** Detect potentially destructive commands; returns reasons (empty => not destructive). */
function detectDestructive(tokens: string[]): string[] {
	if (tokens.length === 0) {
		return [];
	}
	const t0 = tokens[0] ?? '';

	const reasons: string[] = [];

	// rm -r / -rf * . ..
	if (t0 === 'rm') {
		const hasR = tokens.some((t) => /^-.*r/.test(t));
		const hasF = tokens.some((t) => /^-.*f/.test(t));
		const wild = tokens.some(
			(t) => t === '*' || t === '*/' || t.endsWith('/*')
		);
		const rooty = tokens.some(
			(t) => t === '/' || t === '.' || t === '..' || t.startsWith('/')
		);
		if (hasR && (hasF || wild || rooty)) {
			reasons.push('rm -r/-rf with wildcard or root-like target');
		}
	}

	// git reset --hard | git clean -fdx
	if (t0 === 'git') {
		if (tokens.includes('reset') && tokens.some((t) => t === '--hard')) {
			reasons.push('git reset --hard');
		}
		if (
			tokens.includes('clean') &&
			tokens.some((t) => /^-.*f/.test(t)) &&
			(tokens.some((t) => /^-.*d/.test(t)) ||
				tokens.some((t) => /^-.*x/.test(t)))
		) {
			reasons.push('git clean with -f and -d/-x');
		}
	}

	// chmod -R / chown -R
	if (
		(t0 === 'chmod' || t0 === 'chown') &&
		tokens.some((t) => /^-.*R/.test(t))
	) {
		reasons.push(`${t0} -R`);
	}

	// find ... -delete
	if (t0 === 'find' && tokens.includes('-delete')) {
		reasons.push('find -delete');
	}

	return reasons;
}

const ShellExecSpec: ToolSpec = {
	name: 'shell.exec',
	title: 'Run a command',
	description:
		'Execute a command in a sandboxed working directory. Destructive commands require typed confirmation. Non-interactive mode throws on non-zero exit.',
	requiredPermissions: ['shell'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			command: { type: 'string', minLength: 1 },
			args: {
				type: 'array',
				items: { type: 'string' },
				default: [] as string[],
			},
			shell: { type: 'boolean', default: false },
			cwd: { type: 'string', default: '.' },
			env: {
				type: 'object',
				additionalProperties: { type: 'string' },
				default: {} as Record<string, string>,
			},
			timeoutMs: { type: 'integer', minimum: 100, default: 30_000 },
			interactive: { type: 'boolean', default: false },
			confirm: { type: 'string' },
			preview: { type: 'boolean', default: false },
			maxOutputBytes: {
				type: 'integer',
				minimum: 1024,
				default: 1_048_576,
			},
		},
		required: ['command'],
	},
};

const execHandler: ToolHandler = async (params, ctx) => {
	const started = Date.now();

	const p = params as {
		command: string;
		args?: string[];
		shell?: boolean;
		cwd?: string;
		env?: Record<string, string>;
		timeoutMs?: number;
		interactive?: boolean;
		confirm?: string;
		preview?: boolean;
		maxOutputBytes?: number;
	};

	// sandboxed working dir
	const cwdUsed = ensureInside(ctx.cwd, p.cwd ?? '.');

	// normalize tokens for detection
	const tokens =
		p.shell === true
			? looseTokens(p.command)
			: [p.command, ...(p.args ?? [])];

	// destructive detection
	const reasons = detectDestructive(tokens);
	const destructive = reasons.length > 0;

	// Stable token tied to cwd + tokens
	const tokenBase = JSON.stringify({ cwd: cwdUsed, tokens });
	const confirmToken = sha8(tokenBase);

	// Preview or missing confirmation
	if (p.preview === true || (destructive && p.confirm !== confirmToken)) {
		log.info({
			msg: 'shell.exec.preview',
			cwd: cwdUsed,
			command: p.command,
			argsCount: p.shell ? undefined : (p.args ?? []).length,
			shell: p.shell ?? false,
			destructive,
			reasons,
			requiresConfirmation: destructive,
		});
		return {
			preview: true,
			requiresConfirmation: destructive,
			confirmToken,
			destructive,
			reasons,
			cwd: cwdUsed,
			command: p.command,
			args: p.shell ? undefined : (p.args ?? []),
			shell: p.shell ?? false,
		} as Json;
	}

	// --- build spawn args/options (always 3-arg overload) ---
	const timeoutMs = Math.max(100, p.timeoutMs ?? 30_000);
	const maxOutput = Math.max(1024, p.maxOutputBytes ?? 1_048_576);
	const shellFlag = p.shell === true;

	const args = p.args ?? []; // may be empty even when shell=true
	const options = {
		cwd: cwdUsed,
		env: { ...process.env, ...(p.env ?? {}) },
		shell: shellFlag,
	} as const;

	log.info({
		msg: 'shell.exec.start',
		cwd: cwdUsed,
		command: p.command,
		argsCount: shellFlag ? undefined : args.length,
		shell: shellFlag,
		timeoutMs,
		maxOutputBytes: maxOutput,
	});

	const child: ChildProcess = spawn(p.command, args, options);

	const stdoutBufs: Buffer[] = [];
	const stderrBufs: Buffer[] = [];
	let outBytes = 0;
	let errBytes = 0;
	let outTrunc = false;
	let errTrunc = false;

	const toBuf = (d: unknown): Buffer =>
		Buffer.isBuffer(d) ? d : Buffer.from(String(d ?? ''), 'utf8');

	const pushOut = (chunk: Buffer) => {
		if (outBytes >= maxOutput) {
			outTrunc = true;
			return;
		}
		const room = maxOutput - outBytes;
		const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
		stdoutBufs.push(slice);
		outBytes += slice.byteLength;
		if (chunk.byteLength > room) {
			outTrunc = true;
		}
	};

	const pushErr = (chunk: Buffer) => {
		if (errBytes >= maxOutput) {
			errTrunc = true;
			return;
		}
		const room = maxOutput - errBytes;
		const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
		stderrBufs.push(slice);
		errBytes += slice.byteLength;
		if (chunk.byteLength > room) {
			errTrunc = true;
		}
	};

	if (child.stdout) {
		child.stdout.on('data', (d: unknown) => pushOut(toBuf(d)));
	}
	if (child.stderr) {
		child.stderr.on('data', (d: unknown) => pushErr(toBuf(d)));
	}

	let timedOut = false;
	const killer = setTimeout(() => {
		timedOut = true;
		try {
			child.kill('SIGKILL');
			log.warn({
				msg: 'shell.exec.timeout-kill',
				cwd: cwdUsed,
				command: p.command,
				timeoutMs,
			});
		} catch {
			/* ignore */
		}
	}, timeoutMs);

	const exit = await new Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
	}>((resolve) => {
		child.on('error', (err) => {
			log.error({ msg: 'shell.exec.spawn-error', error: err?.message });
			resolve({ code: null, signal: null });
		});
		child.on('close', (code, signal) => resolve({ code, signal }));
	});

	clearTimeout(killer);

	const stdout = Buffer.concat(stdoutBufs).toString('utf8');
	const stderr = Buffer.concat(stderrBufs).toString('utf8');
	const durationMs = Date.now() - started;

	const result = {
		ok: exit.code === 0 && !timedOut,
		exitCode: exit.code,
		signal: exit.signal ?? undefined,
		stdout,
		stderr,
		truncatedStdout: outTrunc,
		truncatedStderr: errTrunc,
		timedOut,
		killed: timedOut,
		durationMs,
		cwd: cwdUsed,
		command: p.command,
		args: p.shell ? undefined : (p.args ?? []),
		shell: shellFlag,
	} as Json;

	log.info({
		msg: 'shell.exec.done',
		cwd: cwdUsed,
		command: p.command,
		exitCode: result.exitCode,
		ok: result.ok,
		timedOut,
		truncatedStdout: outTrunc,
		truncatedStderr: errTrunc,
		stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
		stderrBytes: Buffer.byteLength(stderr, 'utf8'),
		ms: durationMs,
	});

	// Non-interactive: propagate non-zero as ToolExecutionError
	if (
		!p.interactive &&
		(!result.ok ||
			typeof result.exitCode !== 'number' ||
			result.exitCode !== 0)
	) {
		const msg = timedOut
			? `timeout after ${timeoutMs}ms`
			: `exit ${result.exitCode}${stderr ? ` — ${stderr.split('\n', 1)[0]}` : ''}`;
		log.error({
			msg: 'shell.exec.error',
			cwd: cwdUsed,
			command: p.command,
			error: msg,
		});
		throw new ToolExecutionError('shell.exec', new Error(msg));
	}

	return result;
};

export function registerShellTools(reg: ToolRegistry): void {
	reg.register(ShellExecSpec, execHandler);
}
