import fs from 'node:fs';
import path from 'node:path';
import {
	buildTimelineFromSession,
	findSessionFileByName,
	loadSessionFile,
	renderTimelineText,
} from '@sessions/history';
import { sessionsDir as staticSessionsDir } from '@util/paths';

type Plain = Record<string, unknown>;

export interface SessionsListOptions {
	json?: boolean;
}

export interface SessionsShowOptions {
	idOrName: string;
	json?: boolean;
}

export interface SessionsExportOptions {
	idOrName: string;
	format?: 'json' | 'md';
	outPath?: string;
}

function currentSessionsDir(): string {
	return path.join(process.cwd(), '.wraith', 'sessions');
}

async function handleSessionsHistory(opts: {
	nameOrPath: string;
	json?: boolean;
	limit?: number;
}): Promise<number> {
	try {
		const dir = currentSessionsDir();
		const file = findSessionFileByName(dir, opts.nameOrPath);
		const session = loadSessionFile(file);
		const events = buildTimelineFromSession(session);

		if (opts.json) {
			const out = {
				ok: true as const,
				file,
				events,
			};
			process.stdout.write(`${JSON.stringify(out)}\n`);
			return await Promise.resolve(0);
		}

		const text = renderTimelineText(events, opts.limit);
		process.stdout.write(text.length ? `${text}\n` : '(no events)\n');
		return await Promise.resolve(0);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`${msg}\n`);
		return await Promise.resolve(1);
	}
}

export function registerSessionsHistorySubcommand(program: unknown): void {
	// biome-ignore lint/suspicious/noExplicitAny: CLI frameworks are duck-typed
	const app: any = program;

	if (
		typeof app.command === 'function' &&
		typeof app.option === 'function' &&
		typeof app.action === 'function'
	) {
		app.command('sessions history <nameOrPath>')
			.describe('Show a chronological timeline of a session')
			.option('--json', 'Emit JSON timeline')
			.option(
				'--limit <n>',
				'Show only the last N events',
				Number.parseInt
			)
			.action(
				async (nameOrPath: string, flags: Record<string, unknown>) => {
					const code = await handleSessionsHistory({
						nameOrPath,
						json: flags.json === true,
						limit:
							typeof flags.limit === 'number' &&
							Number.isFinite(flags.limit)
								? (flags.limit as number)
								: undefined,
					});
					process.exitCode = code;
				}
			);
		return;
	}

	const cmd = app
		.command('sessions history <nameOrPath>')
		.description('Show a chronological timeline of a session')
		.option('--json', 'Emit JSON timeline')
		.option('--limit <n>', 'Show only the last N events');

	cmd.action(async (nameOrPath: string, flags: Record<string, unknown>) => {
		const lim =
			typeof flags.limit === 'string'
				? Number.parseInt(flags.limit, 10)
				: undefined;
		const code = await handleSessionsHistory({
			nameOrPath,
			json: flags.json === true,
			limit:
				typeof lim === 'number' && Number.isFinite(lim)
					? lim
					: undefined,
		});
		process.exitCode = code;
	});
}

const INCLUDE_GLOBAL = process.env.WRAITH_SESSIONS_INCLUDE_GLOBAL === '1';

function candidateDirs(): string[] {
	const dirs: string[] = [];
	const cur = currentSessionsDir();
	if (fs.existsSync(cur)) {
		dirs.push(cur);
	}
	if (
		INCLUDE_GLOBAL &&
		staticSessionsDir !== cur &&
		fs.existsSync(staticSessionsDir)
	) {
		dirs.push(staticSessionsDir);
	}
	return dirs;
}

function safeReadJson(file: string): Plain | undefined {
	try {
		const raw = fs.readFileSync(file, 'utf8');
		return JSON.parse(raw) as Plain;
	} catch {
		return;
	}
}

function base(file: string): string {
	return path.basename(file, path.extname(file));
}

function listJsonFiles(dir: string): string[] {
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.toLowerCase().endsWith('.json'))
			.map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

function summarize(file: string, data: Plain) {
	const meta = (data.meta ?? {}) as Plain;
	const usage = (data.usage ?? {}) as Plain;
	return {
		path: file,
		file: path.basename(file),
		id: String(meta.id ?? ''),
		name: String(meta.name ?? base(file)),
		createdAt: String(meta.createdAt ?? ''),
		model: String(meta.model ?? ''),
		profile:
			typeof meta.profile === 'string'
				? (meta.profile as string)
				: undefined,
		totalTokens:
			typeof usage.totalTokens === 'number'
				? (usage.totalTokens as number)
				: undefined,
	};
}

function readAllSessions(): { file: string; data: Plain }[] {
	const out: { file: string; data: Plain }[] = [];
	for (const dir of candidateDirs()) {
		for (const f of listJsonFiles(dir)) {
			const data = safeReadJson(f);
			if (data) {
				out.push({ file: f, data });
			}
		}
	}
	return out;
}

function findSessionFile(
	idOrName: string
): { file: string; data: Plain } | undefined {
	// match by (1) filename (w/o .json), (2) meta.name, (3) meta.id
	const all = readAllSessions();
	const want = idOrName.trim();
	for (const s of all) {
		if (base(s.file) === want) {
			return s;
		}
		const meta = (s.data.meta ?? {}) as Plain;
		if (typeof meta.name === 'string' && meta.name === want) {
			return s;
		}
		if (typeof meta.id === 'string' && meta.id === want) {
			return s;
		}
	}
	return;
}

function messagesFrom(data: Plain): Array<{ role: string; content: string }> {
	// Be resilient to structure variants
	const m = data.messages;
	if (Array.isArray(m)) {
		return m
			.filter(
				(x) =>
					x &&
					typeof x.role === 'string' &&
					typeof x.content === 'string'
			)
			.map((x) => ({ role: String(x.role), content: String(x.content) }));
	}
	const turns = (data as { turns?: Plain[] }).turns;
	if (Array.isArray(turns)) {
		return turns
			.filter(
				(t) =>
					t &&
					typeof t.role === 'string' &&
					typeof t.content === 'string'
			)
			.map((t) => ({ role: String(t.role), content: String(t.content) }));
	}
	return [];
}

function toMarkdown(file: string, data: Plain): string {
	const meta = (data.meta ?? {}) as Plain;
	const name = String(meta.name ?? base(file));
	const id = String(meta.id ?? '');
	const created = String(meta.createdAt ?? '');
	const model = String(meta.model ?? '');
	const profile =
		typeof meta.profile === 'string' ? (meta.profile as string) : '';
	const usage = (data.usage ?? {}) as Plain;
	const totalTokens =
		typeof usage.totalTokens === 'number'
			? (usage.totalTokens as number)
			: undefined;

	const lines: string[] = [];
	lines.push(`# Session: ${name}${id ? ` (${id})` : ''}`);
	if (created || model || profile) {
		lines.push('');
		lines.push(`- **Created:** ${created || 'unknown'}`);
		lines.push(`- **Model:** ${model || 'unknown'}`);
		if (profile) {
			lines.push(`- **Profile:** ${profile}`);
		}
		if (typeof totalTokens === 'number') {
			lines.push(`- **Total tokens:** ${totalTokens}`);
		}
	}
	const msgs = messagesFrom(data);
	if (msgs.length > 0) {
		lines.push('');
		lines.push('## Transcript');
		lines.push('');
		for (const m of msgs) {
			lines.push(`**${m.role}:**`);
			lines.push('');
			// Keep it simple and readable in terminals
			lines.push(m.content.trim());
			lines.push('');
		}
	}
	return `${lines.join('\n').trim()}\n`;
}

export async function handleSessionsListCommand(
	opts: SessionsListOptions
): Promise<number> {
	const all = readAllSessions().map((s) => summarize(s.file, s.data));
	if (opts.json) {
		process.stdout.write(`${JSON.stringify({ sessions: all }, null, 2)}\n`);
		return 0;
	}
	if (all.length === 0) {
		process.stdout.write('No sessions found.\n');
		return 0;
	}
	// Plain table
	process.stdout.write('Sessions:\n');
	for (const s of all) {
		const when = s.createdAt || 'unknown';
		const model = s.model || 'unknown';
		const name = s.name || s.id || base(s.file);
		const toks =
			typeof s.totalTokens === 'number'
				? `, tokens=${s.totalTokens}`
				: '';
		process.stdout.write(
			`- ${name}  (${when}; model=${model}${toks})  [${path.relative(process.cwd(), s.path)}]\n`
		);
	}
	return await Promise.resolve(0);
}

export async function handleSessionsShowCommand(
	opts: SessionsShowOptions
): Promise<number> {
	const found = findSessionFile(opts.idOrName);
	if (!found) {
		const msg = `Session not found: ${opts.idOrName}`;
		if (opts.json) {
			process.stdout.write(
				`${JSON.stringify({ ok: false, error: { message: msg } })}\n`
			);
		} else {
			process.stderr.write(`${msg}\n`);
		}
		return 1;
	}
	const summary = summarize(found.file, found.data);
	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify({ ok: true, session: summary }, null, 2)}\n`
		);
		return 0;
	}
	process.stdout.write(`Session: ${summary.name} (${summary.id})\n`);
	process.stdout.write(`Created: ${summary.createdAt || 'unknown'}\n`);
	process.stdout.write(
		`Model: ${summary.model || 'unknown'}${summary.profile ? ` (profile: ${summary.profile})` : ''}\n`
	);
	if (typeof summary.totalTokens === 'number') {
		process.stdout.write(`Total tokens: ${summary.totalTokens}\n`);
	}
	process.stdout.write(
		`File: ${path.relative(process.cwd(), summary.path)}\n`
	);
	return await Promise.resolve(0);
}

export async function handleSessionsExportCommand(
	opts: SessionsExportOptions
): Promise<number> {
	const found = findSessionFile(opts.idOrName);
	if (!found) {
		const msg = `Session not found: ${opts.idOrName}`;
		process.stderr.write(`${msg}\n`);
		return await Promise.resolve(1);
	}
	const fmt: 'json' | 'md' = opts.format === 'md' ? 'md' : 'json';
	let payload: string;
	if (fmt === 'json') {
		payload = `${JSON.stringify(found.data, null, 2)}\n`;
	} else {
		payload = toMarkdown(found.file, found.data);
	}

	if (opts.outPath && opts.outPath.trim().length > 0) {
		const p = path.resolve(opts.outPath);
		const dir = path.dirname(p);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
			if (process.platform !== 'win32') {
				try {
					fs.chmodSync(dir, 0o700);
				} catch {
					// ignore
				}
			}
		}
		fs.writeFileSync(p, payload, 'utf8');
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(p, 0o600);
			} catch {
				// ignore
			}
		}
		process.stdout.write(`${p}\n`);
		return await Promise.resolve(0);
	}
	process.stdout.write(payload);
	return await Promise.resolve(0);
}

export function registerSessionsCommands(program: unknown): void {
	// biome-ignore lint/suspicious/noExplicitAny: CLI is duck-typed
	const app: any = program;

	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const addList = (cmd: any) =>
		cmd
			.description('List saved sessions')
			.option('--json', 'Emit JSON list')
			.action(async (flags: Record<string, unknown>) => {
				const code = await handleSessionsListCommand({
					json: flags.json === true,
				});
				process.exitCode = code;
			});

	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const addShow = (cmd: any) =>
		cmd
			.description(
				'Show a session summary (by name, id, or filename w/o .json)'
			)
			.option('--json', 'Emit JSON summary')
			.action(
				async (idOrName: string, flags: Record<string, unknown>) => {
					const code = await handleSessionsShowCommand({
						idOrName,
						json: flags.json === true,
					});
					process.exitCode = code;
				}
			);

	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const addExport = (cmd: any) =>
		cmd
			.description('Export a session as JSON or Markdown')
			.option('--format <fmt>', 'json|md', 'json')
			.option('--out <file>', 'Write to file; default stdout')
			.action(
				async (idOrName: string, flags: Record<string, unknown>) => {
					const code = await handleSessionsExportCommand({
						idOrName,
						format:
							typeof flags.format === 'string' &&
							flags.format.toLowerCase().trim() === 'md'
								? 'md'
								: 'json',
						outPath:
							typeof flags.out === 'string'
								? (flags.out as string)
								: undefined,
					});
					process.exitCode = code;
				}
			);

	// sade-style
	if (
		typeof app.command === 'function' &&
		typeof app.option === 'function' &&
		typeof app.action === 'function'
	) {
		addList(app.command('sessions list'));
		addShow(app.command('sessions show <nameOrId>'));
		addExport(app.command('sessions export <nameOrId>'));
		return;
	}

	// commander-style
	addList(app.command('sessions list'));
	addShow(app.command('sessions show <nameOrId>'));
	addExport(app.command('sessions export <nameOrId>'));
}
