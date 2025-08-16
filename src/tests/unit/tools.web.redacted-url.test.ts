import http from 'node:http';
import { ToolRegistry } from '@tools/registry';
import type { Permission } from '@tools/types';
import { registerWebTools } from '@tools/web';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
	server = http.createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('ok');
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

describe('web.fetch returns redacted URL', () => {
	it('masks common secret-like query params', async () => {
		const reg = new ToolRegistry();
		registerWebTools(reg);
		const ctx = {
			cwd: process.cwd(),
			policy: { allowPermissions: ['net'] as const },
		};

		const res = await reg.run<{ url: string }>(
			'web.fetch',
			{
				url: `${baseUrl}/ok?apikey=abc&sig=deadbeef&auth=x`,
			},
			ctx as typeof ctx & {
				policy: {
					allowPermissions: Permission[];
				};
			}
		);

		expect(res.url).toContain('apikey=***');
		expect(res.url).toContain('sig=***');
		expect(res.url).toContain('auth=***');
		expect(res.url).not.toContain('deadbeef');
	});
});
