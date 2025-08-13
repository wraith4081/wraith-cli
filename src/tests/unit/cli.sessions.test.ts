import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	handleSessionsExportCommand,
	handleSessionsListCommand,
	handleSessionsShowCommand,
} from '@cli/commands/sessions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mkTmp() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-sessions-'));
	const sdir = path.join(dir, '.wraith', 'sessions');
	fs.mkdirSync(sdir, { recursive: true });
	return { dir, sdir };
}

function writeSession(dir: string, name: string, data: unknown) {
	const p = path.join(dir, `${name}.json`);
	fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
	return p;
}

const OLD_CWD = process.cwd();
let tmp = { dir: '', sdir: '' };

beforeEach(() => {
	tmp = mkTmp();
	process.chdir(tmp.dir);
});

afterEach(() => {
	process.chdir(OLD_CWD);
	vi.restoreAllMocks();
	try {
		fs.rmSync(tmp.dir, { recursive: true, force: true });
	} catch {
		//
	}
});

describe('sessions CLI', () => {
	it('lists and shows sessions (json)', async () => {
		const file = writeSession(tmp.sdir, 'hello', {
			version: 1,
			meta: {
				id: 'abc123',
				name: 'hello',
				createdAt: '2025-08-13T10:00:00Z',
				model: 'gpt-4o',
				profile: 'default',
			},
			messages: [
				{ role: 'user', content: 'hi' },
				{ role: 'assistant', content: 'hey' },
			],
			usage: { totalTokens: 42 },
		});
		expect(fs.existsSync(file)).toBe(true);

		const out = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);

		// list
		await handleSessionsListCommand({ json: true });
		const listed = JSON.parse(
			out.mock.calls.map((c) => String(c[0])).join('')
		).sessions;
		expect(Array.isArray(listed)).toBe(true);
		expect(listed.length).toBe(1);
		expect(listed[0].name).toBe('hello');

		out.mockClear();

		// show
		await handleSessionsShowCommand({ idOrName: 'hello', json: true });
		const shown = JSON.parse(
			out.mock.calls.map((c) => String(c[0])).join('')
		);
		expect(shown.ok).toBe(true);
		expect(shown.session.name).toBe('hello');
		expect(shown.session.id).toBe('abc123');
	});

	it('exports markdown to stdout', async () => {
		writeSession(tmp.sdir, 'demo', {
			version: 1,
			meta: {
				id: 'id1',
				name: 'demo',
				createdAt: '2025-08-13T12:00:00Z',
				model: 'gpt-4o',
			},
			messages: [
				{ role: 'user', content: 'Say hi' },
				{ role: 'assistant', content: 'Hello!' },
			],
		});

		const out = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		await handleSessionsExportCommand({ idOrName: 'demo', format: 'md' });
		const md = out.mock.calls.map((c) => String(c[0])).join('');
		expect(md).toContain('# Session: demo');
		expect(md).toContain('## Transcript');
		expect(md).toContain('Hello!');
	});
});
