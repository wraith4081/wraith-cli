import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerSessionsHistorySubcommand } from '@cli/commands/sessions';
import {
	buildTimelineFromSession,
	renderTimelineText,
} from '@sessions/history';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function mkTmpProj(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-'));
	const sessDir = path.join(dir, '.wraith', 'sessions');
	fs.mkdirSync(sessDir, { recursive: true });
	return dir;
}

function writeSession(dir: string, name: string, data: unknown): string {
	const f = path.join(
		dir,
		'.wraith',
		'sessions',
		`${name}-${Date.now()}.json`
	);
	fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
	return f;
}

describe('sessions history', () => {
	let cwd: string;
	let restore: () => void;

	beforeEach(() => {
		cwd = process.cwd();
		const tmp = mkTmpProj();
		process.chdir(tmp);
		restore = () => process.chdir(cwd);
	});

	afterEach(() => {
		restore();
	});

	it('builds timeline and renders text/json', async () => {
		const sess = {
			name: 'hello',
			createdAt: Date.now() - 1000,
			model: 'gpt-4o-mini',
			turns: [
				{ type: 'user', text: 'Hi there', ts: Date.now() - 900 },
				{ type: 'assistant', text: 'Hello!', ts: Date.now() - 800 },
				{
					type: 'tool_call',
					tool: 'fs.write',
					args: { path: 'README.md', content: '# hi' },
					approved: true,
					ts: Date.now() - 700,
				},
				{
					type: 'tool_result',
					tool: 'fs.write',
					ok: true,
					result: { bytes: 4 },
					ts: Date.now() - 690,
				},
				{
					type: 'file_change',
					change: 'write',
					path: 'README.md',
					diff: '---\n+++',
					ts: Date.now() - 680,
				},
			],
		};
		writeSession(process.cwd(), 'hello', sess);

		// Unit of builder/renderer (no CLI)
		const evs = buildTimelineFromSession(sess);
		expect(evs.length).toBeGreaterThan(0);
		const text = renderTimelineText(evs);
		expect(text).toContain('you: Hi there');
		expect(text).toContain('assistant: Hello!');
		expect(text).toContain('tool: fs.write (approved)');
		expect(text).toContain('file write: README.md');

		// CLI smoke: run via a tiny sade-like shim
		const out = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		const err = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);

		// A minimal "program" to satisfy our duck-typed register
		const calls: Array<() => Promise<void>> = [];
		const program = {
			command(_spec: string) {
				return this;
			},
			describe(_d: string) {
				return this;
			},
			description(_d: string) {
				return this;
			},
			option(_f: string, _d: string, _def?: unknown) {
				return this;
			},
			action(fn: (...args: unknown[]) => unknown) {
				// run later
				calls.push(async () => {
					await fn('hello', { json: true });
				});
				return this;
			},
		};

		// biome-ignore lint/suspicious/noExplicitAny: tbd
		registerSessionsHistorySubcommand(program as any);

		// execute the action we queued
		await calls[0]();

		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		expect(printed).toContain('"ok":true');
		expect(printed).toContain('"events"');

		out.mockRestore();
		err.mockRestore();
	});

	it('respects --limit', async () => {
		const sess = {
			name: 'limittest',
			turns: [
				{ type: 'user', text: 'A', ts: 1 },
				{ type: 'assistant', text: 'B', ts: 2 },
				{ type: 'user', text: 'C', ts: 3 },
				{ type: 'assistant', text: 'D', ts: 4 },
			],
		};
		writeSession(process.cwd(), 'limittest', sess);

		const out = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		const err = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);

		const actions: Array<
			(flags?: Record<string, unknown>) => Promise<void>
		> = [];
		const program = {
			command() {
				return this;
			},
			description() {
				return this;
			},
			describe() {
				return this;
			},
			option() {
				return this;
			},
			action(
				fn: (name: string, flags: Record<string, unknown>) => unknown
			) {
				actions.push(async () => {
					await fn('limittest', { limit: '2' });
				});
				return this;
			},
		};

		// biome-ignore lint/suspicious/noExplicitAny: tbd
		registerSessionsHistorySubcommand(program as any);
		await actions[0]();

		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		// last 2 events are C and D
		expect(printed).toMatch(/you: C[\s\S]*assistant: D/);

		out.mockRestore();
		err.mockRestore();
	});
});
