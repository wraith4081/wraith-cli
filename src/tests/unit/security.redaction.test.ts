import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ToolPermissionError } from '@tools/errors';
import { registerFsTools } from '@tools/fs';
import { ToolRegistry } from '@tools/registry';
import { registerShellTools } from '@tools/shell';
import type { Permission } from '@tools/types';
import { registerWebTools } from '@tools/web';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';

function shellCtx(tmpCwd: string) {
	return {
		cwd: tmpCwd,
		policy: { allowPermissions: ['shell'] as const },
	};
}
function webCtx(tmpCwd: string) {
	return {
		cwd: tmpCwd,
		policy: { allowPermissions: ['net'] as const },
	};
}
function fsCtx(tmpCwd: string) {
	return {
		cwd: tmpCwd,
		policy: { allowPermissions: ['fs'] as const },
	};
}

let tmp: string;
beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-sec-'));
});
afterEach(() => {
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe('secret redaction in outputs', () => {
	let server: http.Server;
	let baseUrl = '';

	beforeAll(async () => {
		server = http.createServer((req, res) => {
			const url = req.url ?? '/';
			if (url.startsWith('/echo')) {
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end('ok');
				return;
			}
			res.writeHead(404).end('no');
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', () => resolve())
		);
		const addr = server.address();
		if (addr && typeof addr === 'object') {
			baseUrl = `http://127.0.0.1:${addr.port}`;
		}
	});
	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('scrubs secret env values from shell output', async () => {
		// simulate a real-looking key
		const secret = 'sk_test_abcdefghijklmnop123456';
		process.env.OPENAI_API_KEY = secret;

		const reg = new ToolRegistry();
		registerShellTools(reg);
		const ctx = shellCtx(tmp);

		// Print the var via the platform shell (portable & always present)
		const isWin = process.platform === 'win32';
		const command = isWin
			? 'echo OPENAI_API_KEY=%OPENAI_API_KEY%'
			: 'echo OPENAI_API_KEY=$OPENAI_API_KEY';
		const out = await reg.run<{ stdout: string }>(
			'shell.exec',
			{ command, shell: true },
			ctx as typeof ctx & {
				policy: {
					allowPermissions: Permission[];
				};
			}
		);

		expect(out.stdout).not.toContain(secret);
		// it should still reveal the variable name, but not the value
		expect(out.stdout).toMatch(/OPENAI_API_KEY=.*\*{3}/);
	});

	it('sanitizes sensitive query params in returned web.fetch URL', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const ctx = webCtx(tmp);

		const url = `${baseUrl}/echo?token=abc123&foo=bar&access_token=ZZZ`;
		const res = await reg.run<{ url: string; ok: boolean }>(
			'web.fetch',
			{ url },
			ctx as typeof ctx & {
				policy: {
					allowPermissions: Permission[];
				};
			}
		);
		expect(res.ok).toBe(true);
		expect(res.url).not.toContain('abc123');
		expect(res.url).not.toContain('ZZZ');
		expect(res.url).toContain('token=***');
		expect(res.url).toContain('access_token=***');
	});
});

describe('sandbox boundaries: block FS/process escapes', () => {
	it('blocks symlink escape on fs.write', async () => {
		// symlinks need admin on win; skip there
		if (process.platform === 'win32') {
			return;
		}

		const outside = fs.mkdtempSync(
			path.join(os.tmpdir(), 'wraith-outside-')
		);
		const reg = new ToolRegistry();
		registerFsTools(reg);
		const ctx = fsCtx(tmp);

		// create link inside tmp -> outside/evil.txt
		const linkInside = path.join(tmp, 'link.txt');
		const outsideFile = path.join(outside, 'evil.txt');
		fs.symlinkSync(outsideFile, linkInside);

		await expect(
			reg.run(
				'fs.write',
				{ path: 'link.txt', content: 'nope' },
				ctx as typeof ctx & {
					policy: {
						allowPermissions: Permission[];
					};
				}
			)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});

	it('blocks cwd escape in shell.exec', async () => {
		const reg = new ToolRegistry();
		registerShellTools(reg);
		const ctx = shellCtx(tmp);

		await expect(
			reg.run(
				'shell.exec',
				{ command: 'pwd', cwd: '../' },
				ctx as typeof ctx & {
					policy: {
						allowPermissions: Permission[];
					};
				}
			)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});
});
