import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ToolPermissionError } from '@tools/errors';
import { ToolRegistry } from '@tools/registry';
import type { ToolContext } from '@tools/types';
import { registerWebTools } from '@tools/web';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function ctx(policy?: Partial<ToolContext['policy']>): ToolContext {
	// CWD is irrelevant for net, but required by ToolContext
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-web-'));
	return {
		cwd,
		policy: {
			allowedTools: policy?.allowedTools,
			deniedTools: policy?.deniedTools,
			allowPermissions: policy?.allowPermissions,
			denyPermissions: policy?.denyPermissions,
		},
	};
}

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const url = req.url ?? '/';
		if (url === '/text') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('hello world');
			return;
		}
		if (url === '/json') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ x: 1 }, null, 0));
			return;
		}
		if (url === '/html') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(
				'<!doctype html><html><head><title>Foo</title></head><body><h1>Hi</h1><p>a <b>b</b></p></body></html>'
			);
			return;
		}
		if (url === '/big') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('A'.repeat(200_000)); // 200 KB
			return;
		}
		res.writeHead(404).end('not found');
	});
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const addr = server.address();
	if (addr && typeof addr === 'object') {
		baseUrl = `http://127.0.0.1:${addr.port}`;
	}
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('web.fetch', () => {
	it('fetches text/plain', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const c = ctx({ allowPermissions: ['net'] });

		const out = await reg.run<{
			ok: boolean;
			contentType?: string;
			text?: string;
		}>('web.fetch', { url: `${baseUrl}/text` }, c);

		expect(out.ok).toBe(true);
		expect(out.contentType).toContain('text/plain');
		expect(out.text).toBe('hello world');
	});

	it('fetches and pretty-prints JSON', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const c = ctx({ allowPermissions: ['net'] });

		const out = await reg.run<{ ok: boolean; text?: string }>(
			'web.fetch',
			{ url: `${baseUrl}/json` },
			c
		);
		expect(out.ok).toBe(true);
		expect(out.text?.startsWith('```json')).toBe(true);
		expect(out.text).toContain('"x": 1');
	});

	it('normalizes HTML to Markdown and plucks title', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const c = ctx({ allowPermissions: ['net'] });

		const out = await reg.run<{
			ok: boolean;
			text?: string;
			title?: string;
		}>('web.fetch', { url: `${baseUrl}/html` }, c);
		expect(out.ok).toBe(true);
		expect(out.title).toBe('Foo');
		// htmlToMarkdown converts <h1> to "# Hi"
		expect(out.text?.includes('# Hi')).toBe(true);
	});

	it('honors maxBytes resulting in truncated output', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const c = ctx({ allowPermissions: ['net'] });

		const out = await reg.run<{ ok: boolean; truncated: boolean }>(
			'web.fetch',
			{ url: `${baseUrl}/big`, maxBytes: 10_000 },
			c
		);
		expect(out.ok).toBe(true);
		expect(out.truncated).toBe(true);
	});

	it('is blocked when net permission is denied', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const c = ctx({ denyPermissions: ['net'] });

		// Registry gates requiredPermissions ⊆ allowPermissions / ∩ denyPermissions
		await expect(
			reg.run('web.fetch', { url: `${baseUrl}/text` }, c)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});

	it('rejects non-http(s) URLs', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const c = ctx({ allowPermissions: ['net'] });

		await expect(
			reg.run('web.fetch', { url: 'file:///etc/hosts' }, c)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});
});
