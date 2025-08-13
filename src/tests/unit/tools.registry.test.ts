import { ToolPermissionError, ToolValidationError } from '@tools/errors';
import { ToolRegistry } from '@tools/registry';
import type { ToolContext, ToolSpec } from '@tools/types';
import { describe, expect, it } from 'vitest';

function ctx(policy?: Partial<ToolContext['policy']>): ToolContext {
	return {
		cwd: process.cwd(),
		policy: {
			allowedTools: policy?.allowedTools,
			deniedTools: policy?.deniedTools,
			allowPermissions: policy?.allowPermissions,
			denyPermissions: policy?.denyPermissions,
		},
	};
}

describe('ToolRegistry', () => {
	it('registers tools and validates params via AJV', async () => {
		const reg = new ToolRegistry();

		const spec: ToolSpec = {
			name: 'util.echo',
			requiredPermissions: [],
			paramsSchema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					message: { type: 'string', minLength: 1 },
					shout: { type: 'boolean', default: false },
				},
				required: ['message'],
			},
		};

		reg.register(spec, (params) => {
			const p = params as { message: string; shout?: boolean };
			return p.shout ? p.message.toUpperCase() : p.message;
		});

		// valid
		const res = await reg.run<string>(
			'util.echo',
			{ message: 'hi' },
			ctx()
		);
		expect(res).toBe('hi');

		// invalid -> AJV error
		await expect(
			reg.run('util.echo', { shout: true }, ctx())
		).rejects.toBeInstanceOf(ToolValidationError);
	});

	it('enforces allow/deny tool lists', async () => {
		const reg = new ToolRegistry();

		reg.register({ name: 't.a' }, () => 'ok');
		reg.register({ name: 't.b' }, () => 'ok');

		// Denied explicitly
		await expect(
			reg.run('t.a', {}, ctx({ deniedTools: ['t.a'] }))
		).rejects.toBeInstanceOf(ToolPermissionError);

		// Allowed list present -> not listed is denied
		await expect(
			reg.run('t.b', {}, ctx({ allowedTools: ['t.a'] }))
		).rejects.toBeInstanceOf(ToolPermissionError);

		// Listed -> allowed
		const ok = await reg.run('t.a', {}, ctx({ allowedTools: ['t.a'] }));
		expect(ok).toBe('ok');
	});

	it('enforces permission requirements', async () => {
		const reg = new ToolRegistry();

		reg.register(
			{ name: 'net.fetch', requiredPermissions: ['net'] },
			() => 'fetched'
		);

		// Deny permission wins
		await expect(
			reg.run('net.fetch', {}, ctx({ denyPermissions: ['net'] }))
		).rejects.toBeInstanceOf(ToolPermissionError);

		// Allow list missing required permission
		await expect(
			reg.run('net.fetch', {}, ctx({ allowPermissions: ['fs'] }))
		).rejects.toBeInstanceOf(ToolPermissionError);

		// Allowed properly
		const out = await reg.run(
			'net.fetch',
			{},
			ctx({ allowPermissions: ['net', 'fs'] })
		);
		expect(out).toBe('fetched');
	});
});
