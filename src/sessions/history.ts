import fs from 'node:fs';
import path from 'node:path';

export type TimelineKind =
	| 'user'
	| 'assistant'
	| 'tool_call'
	| 'tool_result'
	| 'approval'
	| 'file_change'
	| 'checkpoint'
	| 'notice';

export interface TimelineEvent {
	kind: TimelineKind;
	at: number; // epoch ms if available; otherwise logical order
	summary: string;
	detail?: string;
	meta?: Record<string, unknown>;
}

/**
 * Build a tolerant timeline from a session JSON (v1 and future-ish).
 * We accept a few possible shapes to avoid tight coupling.
 */
export function buildTimelineFromSession(raw: unknown): TimelineEvent[] {
	const events: TimelineEvent[] = [];
	const now = Date.now();
	let logical = 0;

	const push = (e: Partial<TimelineEvent>) => {
		events.push({
			kind: (e.kind ?? 'notice') as TimelineKind,
			at:
				typeof e.at === 'number' && Number.isFinite(e.at)
					? e.at
					: now + logical++,
			summary: e.summary ?? '',
			detail: e.detail,
			meta: e.meta,
		});
	};

	const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
		string,
		unknown
	>;

	const turns = Array.isArray(obj.turns) ? (obj.turns as unknown[]) : [];
	for (const t of turns) {
		const ev = t as Record<string, unknown>;

		// allow both {type:'user'|'assistant'} and {role:'user'|'assistant'}
		const type = String(
			('type' in ev ? ev.type : ev.role) ?? ''
		).toLowerCase();
		const ts = toNumber(ev.ts ?? ev.at ?? ev.time);

		if (type === 'user' || type === 'assistant') {
			const text = stringify(ev.text ?? ev.message ?? ev.content);
			push({
				kind: type as 'user' | 'assistant',
				at: ts,
				summary:
					type === 'user'
						? `you: ${firstLine(text)}`
						: `assistant: ${firstLine(text)}`,
				detail: text,
			});
		}

		// inline tools on the turn
		if (Array.isArray(ev.tools)) {
			for (const tc of ev.tools as unknown[]) {
				const te = tc as Record<string, unknown>;
				const tool = stringify(te.tool ?? te.name);
				const args =
					typeof te.args === 'string'
						? te.args
						: safeJson(te.args, undefined);
				const approved = toBool(te.approved);
				push({
					kind: 'tool_call',
					at: toNumber(te.ts ?? te.at) || ts,
					summary: `tool: ${tool}${approved ? ' (approved)' : ''}`,
					detail: args,
					meta: { tool, approved },
				});
			}
		}

		if (type === 'tool_call' || type === 'tool') {
			const tool = stringify(ev.tool ?? ev.name);
			const approved = toBool(ev.approved);
			const args =
				typeof ev.args === 'string'
					? ev.args
					: safeJson(ev.args, undefined);
			push({
				kind: 'tool_call',
				at: ts,
				summary: `tool: ${tool}${approved ? ' (approved)' : ''}`,
				detail: args,
				meta: { tool, approved },
			});
			continue;
		}

		if (type === 'tool_result') {
			const tool = stringify(ev.tool ?? ev.name);
			const ok = ev.ok !== false && !ev.error;
			push({
				kind: 'tool_result',
				at: ts,
				summary: `tool result: ${tool} ${ok ? 'OK' : 'ERR'}`,
				detail:
					typeof ev.result === 'string'
						? ev.result
						: ev.error
							? stringify(ev.error)
							: safeJson(ev.result, undefined),
				meta: { tool, ok },
			});
			continue;
		}

		if (type === 'file_change') {
			const change = stringify(ev.change ?? ev.kind ?? 'edit');
			const file = stringify(ev.path ?? ev.file ?? '');
			push({
				kind: 'file_change',
				at: ts,
				summary: `file ${change}: ${file}`,
				detail:
					typeof ev.diff === 'string'
						? ev.diff
						: safeJson(ev.diff, undefined),
				meta: { file, change },
			});
		}
	}

	const evs = Array.isArray((obj as { events?: unknown[] }).events)
		? ((obj as { events?: unknown[] }).events as unknown[])
		: [];

	for (const e of evs) {
		const rec = e as Record<string, unknown>;
		const kind = stringify(rec.kind ?? rec.type).toLowerCase();
		const at = toNumber(rec.ts ?? rec.at);

		switch (kind) {
			case 'user': {
				const text = stringify(rec.text ?? rec.content);
				push({
					kind: 'user',
					at,
					summary: `you: ${firstLine(text)}`,
					detail: text,
				});
				break;
			}
			case 'assistant': {
				const text = stringify(rec.text ?? rec.content);
				push({
					kind: 'assistant',
					at,
					summary: `assistant: ${firstLine(text)}`,
					detail: text,
				});
				break;
			}
			case 'tool_call':
			case 'tool': {
				const tool = stringify(rec.tool ?? rec.name);
				const approved = toBool(rec.approved);
				push({
					kind: 'tool_call',
					at,
					summary: `tool: ${tool}${approved ? ' (approved)' : ''}`,
					detail:
						typeof rec.args === 'string'
							? rec.args
							: safeJson(rec.args, undefined),
					meta: { tool, approved },
				});
				break;
			}
			case 'tool_result': {
				const tool = stringify(rec.tool ?? rec.name);
				const ok = rec.ok !== false && !rec.error;
				push({
					kind: 'tool_result',
					at,
					summary: `tool result: ${tool} ${ok ? 'OK' : 'ERR'}`,
					detail:
						typeof rec.result === 'string'
							? rec.result
							: rec.error
								? stringify(rec.error)
								: safeJson(rec.result, undefined),
					meta: { tool, ok },
				});
				break;
			}
			case 'approval': {
				const forWhat = stringify(rec.for ?? rec.tool ?? '');
				const granted = toBool(rec.granted ?? rec.approved ?? true);
				push({
					kind: 'approval',
					at,
					summary: `approval: ${granted ? 'granted' : 'denied'}${forWhat ? ` (${forWhat})` : ''}`,
				});
				break;
			}
			case 'file_change': {
				const change = stringify(rec.change ?? rec.kind ?? 'edit');
				const file = stringify(rec.path ?? rec.file ?? '');
				push({
					kind: 'file_change',
					at,
					summary: `file ${change}: ${file}`,
					detail:
						typeof rec.diff === 'string'
							? rec.diff
							: safeJson(rec.diff, undefined),
					meta: { file, change },
				});
				break;
			}
			case 'checkpoint': {
				const label = stringify(rec.label ?? rec.id ?? '');
				push({
					kind: 'checkpoint',
					at,
					summary: `checkpoint ${label ? `(${label})` : ''}`.trim(),
				});
				break;
			}
			default: {
				// keep unknowns as notices to avoid losing data
				const s = safeJson(rec, undefined);
				push({
					kind: 'notice',
					at,
					summary: `event: ${kind || 'unknown'}`,
					detail: s,
				});
			}
		}
	}

	events.sort((a, b) => a.at - b.at);
	return events;
}

export function renderTimelineText(
	events: TimelineEvent[],
	limit?: number
): string {
	const list =
		typeof limit === 'number' && limit > 0 ? events.slice(-limit) : events;
	const lines: string[] = [];
	for (const e of list) {
		const t = new Date(e.at).toISOString();
		const icon = iconFor(e.kind);
		lines.push(`${t} ${icon} ${e.summary}`);
		if (e.detail?.trim()) {
			lines.push(indent(block(e.detail)));
		}
	}
	return lines.join('\n');
}

export function loadSessionFile(p: string): unknown {
	const s = fs.readFileSync(p, 'utf8');
	try {
		return JSON.parse(s) as unknown;
	} catch {
		// tolerate YAML-ish or other formats later; for now JSON only
		throw new Error(`Invalid session JSON: ${p}`);
	}
}

export function findSessionFileByName(dir: string, nameOrPath: string): string {
	if (nameOrPath.includes(path.sep) || nameOrPath.endsWith('.json')) {
		// treat as path (relative or absolute)
		const abs = path.isAbsolute(nameOrPath)
			? nameOrPath
			: path.resolve(process.cwd(), nameOrPath);
		if (!fs.existsSync(abs)) {
			throw new Error(`Session file not found: ${abs}`);
		}
		return abs;
	}
	// search by prefix of basename
	if (!fs.existsSync(dir)) {
		throw new Error(`No sessions directory: ${dir}`);
	}
	const files = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => path.join(dir, f));
	const match =
		files.find((f) => path.basename(f).startsWith(nameOrPath)) ?? '';
	if (!match) {
		throw new Error(`Session not found for: ${nameOrPath}`);
	}
	return match;
}

function stringify(v: unknown): string {
	return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function toNumber(v: unknown): number {
	const n =
		typeof v === 'number'
			? v
			: typeof v === 'string'
				? Number(v)
				: Number.NaN;
	return Number.isFinite(n) ? n : 0;
}
function toBool(v: unknown): boolean {
	return v === true || v === 'true' || v === 1 || v === '1';
}
function firstLine(s: string): string {
	const trimmed = s.trim();
	const i = trimmed.indexOf('\n');
	return i >= 0 ? trimmed.slice(0, i) : trimmed;
}
function iconFor(kind: TimelineKind): string {
	switch (kind) {
		case 'user':
			return '🧑';
		case 'assistant':
			return '🤖';
		case 'tool_call':
			return '🛠️';
		case 'tool_result':
			return '✅';
		case 'approval':
			return '☑️';
		case 'file_change':
			return '✍️';
		case 'checkpoint':
			return '🧩';
		default:
			return '•';
	}
}
function indent(s: string): string {
	return s
		.split(/\r?\n/)
		.map((l) => (l.length ? `  ${l}` : l))
		.join('\n');
}
function block(s: string): string {
	const t = s.trimEnd();
	// Show code fences sparingly; if it's already fenced, leave as-is.
	if (/^```/.test(t)) {
		return t;
	}
	if (t.includes('\n')) {
		return `\`\`\`\n${t}\n\`\`\``;
	}
	return t;
}
function safeJson(
	v: unknown,
	fallback: string | undefined
): string | undefined {
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return fallback;
	}
}
